// Reconstruct a real game's immutable phase history by replaying its resolved
// order log through the pure engine. Costs nothing extra to store (the log is
// already the source of truth) — we just fold it client-side into a board per
// phase, the same frame shape the sandbox navigates. Read-only: the past is fixed.

import { initialBoard, replayLog, roundRank } from './adjudicator'
import type { LogRow, ReplayFrame } from './adjudicator'
import type { MapDefinition } from './mapDefinition'

/** A resolved-orders row as stored in the `orders` table (one per nation per round). */
export type ResolvedOrderRow = LogRow

/** A resolved row with the server time it was last written — the incremental-fetch cursor. */
export type StampedOrderRow = ResolvedOrderRow & { updated_at: string }

export type HistoryFrame = ReplayFrame

/**
 * Fold the resolved log into one frame per phase: each frame is the board going
 * into that phase plus the orders that were resolved there. The final frame is the
 * current live board (its orders are entered live, not from the log).
 */
export function replayFrames(
  map: MapDefinition,
  rows: ResolvedOrderRow[],
  /** The live round, if known: trailing phases nobody ordered in are resolved up to it. */
  until?: Parameters<typeof replayLog>[3],
): HistoryFrame[] {
  return replayLog(map, initialBoard(map), rows, until)
}

/**
 * Merge freshly fetched rows (`fetchResolvedLog(id, since)`) into the cached log. A round
 * present in the delta replaces that whole round (it was resolved again after a revert),
 * and anything at or after the live round is dropped (a revert deleted or reopened it).
 */
export function mergeLog<R extends ResolvedOrderRow>(
  cached: R[],
  delta: R[],
  live: Parameters<typeof roundRank>[0],
): R[] {
  const frontier = roundRank(live)
  const replaced = new Set(delta.map(roundRank))
  return [...cached.filter((r) => !replaced.has(roundRank(r))), ...delta].filter((r) => roundRank(r) < frontier)
}

/** The newest `updated_at` among rows (ISO strings compare chronologically), if any. */
export const newestStamp = (rows: StampedOrderRow[]): string | null =>
  rows.reduce<string | null>((max, r) => (max && max >= r.updated_at ? max : r.updated_at), null)
