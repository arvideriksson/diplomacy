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
export function replayFrames(
  map: MapDefinition,
  rows: ResolvedOrderRow[],
  /** The live round, if known: trailing phases nobody ordered in are resolved up to it. */
  until?: { year: number; season: string; phase: string },
): HistoryFrame[] {
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
  const rank = (r: { year: number; season: string; phase: string }) =>
    r.year * 100 + (SEASON_ORDER[r.season] ?? 0) * 10 + (PHASE_ORDER[r.phase] ?? 0)
  for (const round of ordered) {
    // A phase in which nobody had an order row (everyone idle, or nobody submitted
    // before the deadline) leaves no rows in the log, but the server still resolved
    // it — with no orders. Resolve such phases the same way until the board reaches
    // this round, so every later round replays against the right board.
    for (let guard = 0; rank(state) < rank(round) && guard < 1000; guard++) {
      frames.push({ board: state, orders: [] })
      state = adjudicate(map, state, []).newBoardState
    }
    frames.push({ board: state, orders: round.orders })
    state = adjudicate(map, state, round.orders).newBoardState
  }
  for (let guard = 0; until && PHASE_ORDER[until.phase] !== undefined && rank(state) < rank(until) && guard < 1000; guard++) {
    frames.push({ board: state, orders: [] })
    state = adjudicate(map, state, []).newBoardState
  }
  // Append the current (live) phase: its board is the result of the last resolution.
  frames.push({ board: state, orders: [] })
  return frames
}
