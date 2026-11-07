// The newest messages of each opened press thread, kept on the device so reopening shows
// them at once and fetches only what's newer. Press messages are never edited or deleted
// and channel ids are never reused, so a cached message can't go stale.
import { createDebouncer } from './debounce'
import { deviceCache } from './deviceCache'
import { THREAD_PAGE, type ChatMessage } from './chat'

export type CachedThread = { msgs: ChatMessage[]; hasOlder: boolean }

const threadCache = deviceCache<CachedThread>('chatThreads', 1, 300)
/** Messages kept per cached thread (the newest): one full fetch's worth. */
const THREAD_CACHE_MAX = THREAD_PAGE

/**
 * One panel's view of the cache. `keyOf` names a channel's entry (scoped to the
 * signed-in user); `snapshot` reads a thread's current messages and whether older
 * history exists. Changed threads are written out together after a pause.
 */
export function createThreadCache(keyOf: (id: number) => string, snapshot: (id: number) => CachedThread) {
  const dirty = new Set<number>()
  const saver = createDebouncer(() => {
    for (const id of dirty) {
      const { msgs, hasOlder } = snapshot(id)
      const kept = msgs.slice(-THREAD_CACHE_MAX)
      threadCache.put(keyOf(id), { msgs: kept, hasOlder: hasOlder || kept.length < msgs.length }).catch(() => {})
    }
    dirty.clear()
  }, 1000)
  return {
    /** What this device last saw of a thread; null on a miss or any failure. */
    get: (id: number): Promise<CachedThread | null> => threadCache.get(keyOf(id)).catch(() => null),
    /** Queue a thread for the next save. Only call it for a contiguous run of history. */
    schedule(id: number) {
      dirty.add(id)
      saver.schedule()
    },
    /** Write out pending saves now. */
    flush: () => saver.flush(),
  }
}
