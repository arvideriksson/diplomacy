// Device-local backup of a nation's unsent orders for one round: an unsubmitted draft
// not yet autosaved, or edits made after submitting that haven't been resubmitted.
// Written on every edit and cleared once the server has the set, so leaving abruptly
// (phones) never silently drops orders — and the game list can say "Changes not sent".
import type { AnyOrder } from './orders/types'
import { local } from './localStore'

export interface RoundKey {
  gameId: string
  nation: string
  year: number
  season: string
  phase: string
}

const key = (r: RoundKey) => `diplomacy:draft:${r.gameId}:${r.nation}:${r.year}:${r.season}:${r.phase}`

// Storage unavailable: nothing is backed up, and the server autosave still runs.
export function writeDraftBackup(r: RoundKey, orders: AnyOrder[] | null): void {
  if (orders) local.writeJSON(key(r), orders)
  else local.remove(key(r))
}

export function readDraftBackup(r: RoundKey): AnyOrder[] | null {
  return local.readJSON<AnyOrder[] | null>(key(r), null)
}

/** Whether two order sets are the same orders (order of entries ignored). */
export function sameOrders(a: AnyOrder[], b: AnyOrder[]): boolean {
  const norm = (s: AnyOrder[]) => s.map((o) => JSON.stringify(o, Object.keys(o).sort())).sort().join('\n')
  return a.length === b.length && norm(a) === norm(b)
}
