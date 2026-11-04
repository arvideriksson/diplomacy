// Small on-device caches in IndexedDB, one object store each, least-recently-used
// eviction past a cap. Used for data the server never changes once written (resolved
// order logs, press messages), so a reload or reopen fetches only what's new. Best
// effort throughout: any failure (private mode, quota, blocked storage) reads as a miss.

const DB_NAME = 'diplomacy'
// Every store this database has; adding one bumps DB_VERSION.
const STORES = ['resolvedLog', 'chatThreads'] as const
const DB_VERSION = STORES.length
export type CacheStore = (typeof STORES)[number]

type Entry<T> = { key: string; v: number; value: T; usedAt: number }

let dbPromise: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!req.result.objectStoreNames.contains(name))
            req.result.createObjectStore(name, { keyPath: 'key' }).createIndex('usedAt', 'usedAt')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(store: CacheStore, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return db().then(
    (d) =>
      new Promise<T | null>((resolve) => {
        if (!d) return resolve(null)
        try {
          const req = fn(d.transaction(store, mode).objectStore(store))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

/** Delete the `n` least recently used entries, walking keys only (no values loaded). */
async function evictOldest(store: CacheStore, n: number): Promise<void> {
  const d = await db()
  if (!d) return
  try {
    const s = d.transaction(store, 'readwrite').objectStore(store)
    const req = s.index('usedAt').openKeyCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c || n-- <= 0) return
      s.delete(c.primaryKey)
      c.continue()
    }
  } catch {
    // best effort
  }
}

/**
 * A cache over one store. `version` is the shape of `T`: bump it when that changes and
 * older entries read as misses. Keys should include the viewer's user id, so a shared
 * device never mixes accounts.
 */
export function deviceCache<T>(store: CacheStore, version: number, maxEntries: number) {
  return {
    async get(key: string): Promise<T | null> {
      const e = await run<Entry<T> | undefined>(store, 'readonly', (s) => s.get(key))
      return e && e.v === version ? e.value : null
    },
    async put(key: string, value: T): Promise<void> {
      await run(store, 'readwrite', (s) => s.put({ key, v: version, value, usedAt: Date.now() } satisfies Entry<T>))
      const count = await run<number>(store, 'readonly', (s) => s.count())
      if (count != null && count > maxEntries) await evictOldest(store, count - maxEntries)
    },
  }
}

/** Forget everything cached on this device (on sign-out). */
export async function clearDeviceCaches(): Promise<void> {
  await Promise.all(STORES.map((s) => run(s, 'readwrite', (st) => st.clear())))
}
