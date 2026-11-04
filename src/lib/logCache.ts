// On-device cache of each game's resolved order log, so a reload fetches only the rows
// written since (`fetchResolvedLog(id, since)`) instead of the whole log again. The
// `since` stamp is the version: a host revert re-stamps the rows it touches, and
// `mergeLog` reconciles them — no checksum needed. IndexedDB (not localStorage) since
// a long game's log runs to a few hundred KB. Best effort throughout: any failure
// (private mode, quota, blocked storage) just means a full fetch.

import type { StampedOrderRow } from './history'

const DB_NAME = 'diplomacy'
const STORE = 'resolvedLog'
/** Bump when the cached row shape changes: older entries are ignored. */
const VERSION = 1
/** Games kept; the least recently used beyond this are evicted. */
const MAX_GAMES = 20

type Entry = { key: string; v: number; rows: StampedOrderRow[]; since: string | null; usedAt: number }

let dbPromise: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('usedAt', 'usedAt')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return db().then(
    (d) =>
      new Promise<T | null>((resolve) => {
        if (!d) return resolve(null)
        try {
          const req = fn(d.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

/** Cache key: per viewer as well as per game, so a shared device never mixes accounts. */
export const logKey = (userId: string | undefined, gameId: string) => `${userId ?? 'anon'}:${gameId}`

export async function loadLog(key: string): Promise<{ rows: StampedOrderRow[]; since: string | null } | null> {
  const e = await run<Entry | undefined>('readonly', (s) => s.get(key))
  return e && e.v === VERSION ? { rows: e.rows, since: e.since } : null
}

export async function saveLog(key: string, rows: StampedOrderRow[], since: string | null): Promise<void> {
  await run('readwrite', (s) => s.put({ key, v: VERSION, rows, since, usedAt: Date.now() } satisfies Entry))
  const count = await run<number>('readonly', (s) => s.count())
  if (count != null && count > MAX_GAMES) await evictOldest(count - MAX_GAMES)
}

/** Delete the `n` least recently used entries, walking keys only (no logs loaded). */
async function evictOldest(n: number): Promise<void> {
  const d = await db()
  if (!d) return
  try {
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE)
    const req = store.index('usedAt').openKeyCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c || n-- <= 0) return
      store.delete(c.primaryKey)
      c.continue()
    }
  } catch {
    // best effort
  }
}
