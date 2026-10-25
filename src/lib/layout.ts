import { readable, writable } from 'svelte/store'

/**
 * Chrome state the routed views drive up to the App shell. Kept in a store (not
 * props) because the matched <Route> is a sibling of the floating chrome, not its parent.
 */

/** True when the active view should claim the full viewport and drop the floating page chrome. */
export const immersive = writable(false)

/** Phones and portrait tablets: the game view switches to one pane at a time behind a tab bar. */
export const COMPACT_QUERY = '(max-width: 760px), (orientation: portrait) and (max-width: 1100px)'

/** Whether the viewport matches COMPACT_QUERY (live). */
export const compact = readable(false, (set) => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  const mq = window.matchMedia(COMPACT_QUERY)
  set(mq.matches)
  const onChange = () => set(mq.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
})

/** Desktop widths where the left rail is a docked column (narrower, it's a drawer). */
export const WIDE_QUERY = '(min-width: 1101px)'

/** Whether the viewport matches WIDE_QUERY (live). */
export const wideLayout = readable(false, (set) => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  const mq = window.matchMedia(WIDE_QUERY)
  set(mq.matches)
  const onChange = () => set(mq.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
})

/** The panes of the compact game view, one at a time behind the tab bar. */
export type GameTab = 'press' | 'map' | 'orders'
