// App-wide unit token style, editable from the sandbox and persisted locally.
import { writable } from 'svelte/store'
import { DEFAULT_UNIT_STYLE, type UnitStyle } from './map/unitStyles'

const KEY = 'diplomacy.unitStyle'

function load(): UnitStyle {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_UNIT_STYLE, ...(JSON.parse(raw) as Partial<UnitStyle>) }
  } catch {
    // ignore malformed storage
  }
  return DEFAULT_UNIT_STYLE
}

export const unitStyle = writable<UnitStyle>(load())

unitStyle.subscribe((value) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // ignore quota/availability errors
  }
})
