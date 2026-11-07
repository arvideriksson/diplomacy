// Close a popup (menu, sheet) on a press outside it or on Escape:
//   <div use:dismissable={{ onDismiss: close, enabled: open }}>…toggle + popup…</div>
// Put the toggle inside `node` (or in `ignore`) so pressing it toggles rather than
// dismissing and reopening. Both listeners run in the capture phase, ahead of window
// shortcut handlers; a handled Escape is marked with preventDefault so those can skip it.
// A modal dialog opened over the popup (one the popup isn't inside) takes both first.

export interface DismissableOptions {
  onDismiss: () => void
  /** Listen only while true (default true), e.g. while the popup is open. */
  enabled?: boolean
  /** Elements outside `node` whose presses don't count as outside. */
  ignore?: readonly (Element | null | undefined)[]
}

const editable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

export function dismissable(node: HTMLElement, options: DismissableOptions) {
  let opts = options
  const on = () => opts.enabled !== false
  const inside = (t: EventTarget | null) =>
    t instanceof Node && (node.contains(t) || !!opts.ignore?.some((el) => el?.contains(t)))

  // An open modal dialog the popup isn't part of.
  const modalOver = () => {
    const modal = document.querySelector('[aria-modal="true"]')
    return !!modal && !modal.contains(node)
  }

  function onPointerDown(e: PointerEvent) {
    if (on() && !inside(e.target) && !modalOver()) opts.onDismiss()
  }
  function onKeyDown(e: KeyboardEvent) {
    if (!on() || e.key !== 'Escape' || e.defaultPrevented || modalOver()) return
    // A field inside the popup handles its own Escape (e.g. cancelling a rename).
    if (editable(e.target) && node.contains(e.target as Node)) return
    e.preventDefault()
    opts.onDismiss()
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  return {
    update(next: DismissableOptions) {
      opts = next
    },
    destroy() {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    },
  }
}
