// A trailing-edge debouncer with explicit flush/cancel, for autosaves that must also
// fire immediately on navigation (flush) or be dropped when superseded (cancel).

export interface Debouncer<A extends unknown[]> {
  /** (Re)start the timer; `fn` runs with these args once `ms` pass without another call. */
  schedule: (...args: A) => void
  /** Run a pending call now (no-op when nothing is pending). */
  flush: () => void
  /** Drop a pending call without running it. */
  cancel: () => void
}

export function createDebouncer<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debouncer<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = null
  }
  const flush = () => {
    if (pending === null) return
    const args = pending
    cancel()
    fn(...args)
  }
  const schedule = (...args: A) => {
    if (timer !== null) clearTimeout(timer)
    pending = args
    timer = setTimeout(flush, ms)
  }
  return { schedule, flush, cancel }
}
