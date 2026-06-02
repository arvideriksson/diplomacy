// Reconstruct a real game's immutable phase history by replaying its resolved
// order log through the pure engine. Costs nothing extra to store (the log is
// already the source of truth) — we just fold it client-side into a board per
// phase, the same frame shape the sandbox navigates. Read-only: the past is fixed.

import { adjudicate, initialBoard } from './adjudicator'
import type { AnyOrder, BoardState } from './adjudicator'
import type { MapDefinition } from './mapDefinition'

/** A resolved-orders row as stored in the `orders` table (one per nation per round). */
export interface ResolvedOrderRow {
  year: number
  season: string
  phase: string
  nation: string
  orders: AnyOrder[]
}

export interface HistoryFrame {
  board: BoardState
  orders: AnyOrder[]
}

const SEASON_ORDER: Record<string, number> = { Spring: 0, Fall: 1 }
const PHASE_ORDER: Record<string, number> = { movement: 0, retreat: 1, build: 2 }

/**
 * Fold the resolved log into one frame per phase: each frame is the board going
 * into that phase plus the orders that were resolved there. The final frame is the
 * current live board (its orders are entered live, not from the log).
 */
export function replayFrames(map: MapDefinition, rows: ResolvedOrderRow[]): HistoryFrame[] {
  // Group the per-nation rows into rounds keyed by (year, season, phase).
  const rounds = new Map<string, { year: number; season: string; phase: string; orders: AnyOrder[] }>()
  for (const r of rows) {
    const key = `${r.year}|${r.season}|${r.phase}`
    const round = rounds.get(key) ?? { year: r.year, season: r.season, phase: r.phase, orders: [] }
    round.orders.push(...(r.orders ?? []))
    rounds.set(key, round)
  }
  const ordered = [...rounds.values()].sort(
    (a, b) =>
      a.year - b.year ||
      (SEASON_ORDER[a.season] ?? 0) - (SEASON_ORDER[b.season] ?? 0) ||
      (PHASE_ORDER[a.phase] ?? 0) - (PHASE_ORDER[b.phase] ?? 0),
  )

  const frames: HistoryFrame[] = []
  let state = initialBoard(map)
  for (const round of ordered) {
    frames.push({ board: state, orders: round.orders })
    state = adjudicate(map, state, round.orders).newBoardState
  }
  // Append the current (live) phase: its board is the result of the last resolution.
  frames.push({ board: state, orders: [] })
  return frames
}
