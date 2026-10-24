import { writable } from 'svelte/store'

/**
 * Chrome state the routed views drive up to the App shell. Kept in a store (not
 * props) because the matched <Route> is a sibling of the floating chrome, not its parent.
 */

/** True when the active view should claim the full viewport and drop the floating page chrome. */
export const immersive = writable(false)
