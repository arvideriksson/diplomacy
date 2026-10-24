// Reconstruct a real game's immutable phase history by replaying its resolved
// order log through the pure engine. Costs nothing extra to store (the log is
// already the source of truth) — we just fold it client-side into a board per
// phase, the same frame shape the sandbox navigates. Read-only: the past is fixed.

import { initialBoard, replayLog } from './adjudicator'
import type { LogRow, ReplayFrame, RoundKey } from './adjudicator'
import type { MapDefinition } from './mapDefinition'

/** A resolved-orders row as stored in the `orders` table (one per nation per round). */
export type ResolvedOrderRow = LogRow

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
  until?: RoundKey,
): HistoryFrame[] {
  return replayLog(map, initialBoard(map), rows, until)
}
