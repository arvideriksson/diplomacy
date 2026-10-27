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
