// Guarded Web Storage: every access is try/catch'd, so private mode, a full quota or
// blocked site data reads as "nothing stored" and a write just doesn't stick. Only for
// per-device conveniences that the app works without.

export type GuardedStorage = ReturnType<typeof guarded>

function guarded(area: () => Storage) {
  /** The stored string, or null when absent or storage is unavailable. */
  function read(key: string): string | null {
    try {
      return area().getItem(key)
    } catch {
      return null
    }
  }
  /** Store a string; false when storage refused it. */
  function write(key: string, value: string): boolean {
    try {
      area().setItem(key, value)
      return true
    } catch {
      return false
    }
  }
  function remove(key: string): void {
    try {
      area().removeItem(key)
    } catch {
      /* storage unavailable: nothing to remove */
    }
  }
  /** The parsed value, or `fallback` when absent, empty, unparsable or unavailable. */
  function readJSON<T>(key: string, fallback: T): T {
    const raw = read(key)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }
  /** Store a value as JSON; false when it couldn't be serialized or stored. */
  function writeJSON(key: string, value: unknown): boolean {
    let raw: string
    try {
      raw = JSON.stringify(value)
    } catch {
      return false
    }
    return write(key, raw)
  }
  /** A '1' flag: set when on, removed when off. */
  function readFlag(key: string): boolean {
    return read(key) === '1'
  }
  function writeFlag(key: string, on: boolean): void {
    if (on) write(key, '1')
    else remove(key)
  }
  /** Read a string and remove it (a one-shot hand-off). */
  function take(key: string): string | null {
    const value = read(key)
    remove(key)
    return value
  }
  return { read, write, remove, readJSON, writeJSON, readFlag, writeFlag, take }
}

/** `localStorage`, guarded. */
export const local = guarded(() => localStorage)
/** `sessionStorage`, guarded. */
export const session = guarded(() => sessionStorage)
