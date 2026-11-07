// Unread accounting for the press panel: per channel, the others' messages not yet seen
// (id → time), published as counts. By id, so a message both fetched and delivered live
// counts once.
import { writable } from 'svelte/store'
import type { ChatMessage } from './chat'

export function createUnread() {
  const unread = writable<Record<number, number>>({})
  const unseen = new Map<number, Map<number, string>>()

  function publish(id: number) {
    const n = unseen.get(id)?.size ?? 0
    unread.update((u) => (u[id] === n ? u : { ...u, [id]: n }))
  }

  /** Take the server's view of a channel's unread messages (fetched after `cursor`),
   *  keeping live ones it couldn't have included: newer than anything it returned and
   *  than the cursor. Anything older it left out was read (maybe on another device). */
  function apply(id: number, rows: { id: number; created_at: string }[], cursor: string | undefined) {
    const floor = [cursor ?? '', ...rows.map((r) => r.created_at)].reduce((a, b) => (b > a ? b : a), '')
    const next = new Map(rows.map((r) => [r.id, r.created_at] as const))
    for (const [mid, at] of unseen.get(id) ?? []) if (at > floor) next.set(mid, at)
    unseen.set(id, next)
    publish(id)
  }

  /** A message the viewer hasn't seen yet. */
  function add(m: ChatMessage) {
    let set = unseen.get(m.channel_id)
    if (!set) unseen.set(m.channel_id, (set = new Map()))
    set.set(m.id, m.created_at)
    publish(m.channel_id)
  }

  /** Everything in a channel has been seen. */
  function clear(id: number) {
    unseen.delete(id)
    publish(id)
  }

  return { unread, apply, add, clear }
}
