// On-device cache of each game's resolved order log, so a reload fetches only the rows
// written since (`fetchResolvedLog(id, since)`) instead of the whole log again. The
// `since` stamp is the version: a host revert re-stamps the rows it touches, and
// `mergeLog` reconciles them — no checksum needed. IndexedDB (lib/deviceCache) since a
// long game's log runs to a few hundred KB. A miss just means a full fetch.

import type { StampedOrderRow } from './history'
import { deviceCache } from './deviceCache'

type CachedLog = { rows: StampedOrderRow[]; since: string | null }

/** Games kept; the least recently used beyond this are evicted. */
const cache = deviceCache<CachedLog>('resolvedLog', 2, 20)

/** Cache key: per viewer as well as per game, so a shared device never mixes accounts. */
export const logKey = (userId: string | undefined, gameId: string) => `${userId ?? 'anon'}:${gameId}`

export const loadLog = (key: string): Promise<CachedLog | null> => cache.get(key)

export const saveLog = (key: string, rows: StampedOrderRow[], since: string | null): Promise<void> =>
  cache.put(key, { rows, since })
