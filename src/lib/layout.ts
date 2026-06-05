import { writable } from 'svelte/store'

/**
 * Chrome state the routed views drive up to the App shell. Kept in a store (not
 * props) because the matched <Route> is a sibling of the header/main, not a child.
 */

/** True when the active view should claim the full viewport and hide the header. */
export const immersive = writable(false)

/** Breadcrumb shown next to the logo (e.g. the lobby's game name). Empty hides it. */
export const crumb = writable('')
