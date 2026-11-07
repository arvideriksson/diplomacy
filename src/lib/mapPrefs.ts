import { writable } from 'svelte/store'

// Per-device map display preferences, kept in localStorage.

const INFLUENCE_KEY = 'map-influence-paint'

function read(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

/** Tint non-SC provinces by the power holding a majority of their adjacent centers. Off by default. */
export const influencePaint = writable(read(INFLUENCE_KEY))

influencePaint.subscribe((on) => {
  try { on ? localStorage.setItem(INFLUENCE_KEY, '1') : localStorage.removeItem(INFLUENCE_KEY) } catch {}
})

// Desktop: either game sidebar can be hidden to give the map the room; remembered per
// browser. Read once when a board mounts, written whenever it toggles (each board keeps
// its own state while open).
const PANELS_KEY = 'game:hidden-panels'

export interface HiddenPanels {
  left: boolean
  right: boolean
}

export function readHiddenPanels(): HiddenPanels {
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}')
    return { left: saved.left === true, right: saved.right === true }
  } catch {
    return { left: false, right: false } // no storage: both sidebars start shown
  }
}

export function writeHiddenPanels(panels: HiddenPanels): void {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(panels))
  } catch {
    /* not remembered */
  }
}
