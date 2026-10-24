// Event sourcing: the authoritative board is the result of folding `adjudicate`
// over the ordered log of resolved rounds. Because `adjudicate` is pure and
// deterministic, replaying the log always reproduces the same state.

import type { MapDefinition } from '../mapDefinition'
import type { AnyOrder, BoardState, RoundKey } from './types'

export interface ResolvedRound extends RoundKey {
  orders: AnyOrder[]
}

import { adjudicate } from './resolve'

/** Replay every resolved round in order, returning the final board state. */
export function foldGame(
  map: MapDefinition,
  initial: BoardState,
  log: ResolvedRound[],
): BoardState {
  let state = initial
  for (const round of log) {
    state = adjudicate(map, state, round.orders).newBoardState
  }
  return state
}

/** A resolved-orders row as stored in the `orders` table (one per nation per round). */
export type LogRow = RoundKey & {
  nation: string
  orders: AnyOrder[]
}

/** One replayed phase: the board going into it plus the orders resolved there. */
export interface ReplayFrame {
  board: BoardState
  orders: AnyOrder[]
}

const SEASON_ORDER: Record<string, number> = { Spring: 0, Fall: 1 }
const PHASE_ORDER: Record<string, number> = { movement: 0, retreat: 1, build: 2 }

/** A round whose phase may also be a non-order game phase (lobby, complete, …). */
type LooseRoundKey = Omit<RoundKey, 'phase'> & { phase: string }

/** Chronological sort key for a round. Mirrors round_rank() in the host-controls migration. */
export const roundRank = (r: LooseRoundKey): number =>
  r.year * 100 + (SEASON_ORDER[r.season] ?? 0) * 10 + (PHASE_ORDER[r.phase] ?? 0)

/**
 * Fold the per-nation log rows into one frame per phase, the last being the board
 * after the final round. Each order's `nation` is forced to its row's nation, exactly
 * as the adjudicator does at resolution, so a replay matches what was adjudicated.
 */
export function replayLog(
  map: MapDefinition,
  initial: BoardState,
  rows: LogRow[],
  /**
   * The live round, if known: trailing phases nobody ordered in are resolved up to it.
   * A non-order phase (lobby, complete) is ignored.
   */
  until?: LooseRoundKey,
): ReplayFrame[] {
  const rounds = new Map<string, ResolvedRound>()
  for (const r of rows) {
    const key = `${r.year}|${r.season}|${r.phase}`
    const round = rounds.get(key) ?? { year: r.year, season: r.season, phase: r.phase, orders: [] }
    round.orders.push(...(r.orders ?? []).map((o) => ({ ...o, nation: r.nation })))
    rounds.set(key, round)
  }
  const ordered = [...rounds.values()].sort((a, b) => roundRank(a) - roundRank(b))

  const frames: ReplayFrame[] = []
  let state = initial
  for (const round of ordered) {
    // A phase in which nobody had an order row (everyone idle, or nobody submitted
    // before the deadline) leaves no rows in the log, but the server still resolved
    // it — with no orders. Resolve such phases the same way until the board reaches
    // this round, so every later round replays against the right board.
    for (let guard = 0; roundRank(state) < roundRank(round) && guard < 1000; guard++) {
      frames.push({ board: state, orders: [] })
      state = adjudicate(map, state, []).newBoardState
    }
    frames.push({ board: state, orders: round.orders })
    state = adjudicate(map, state, round.orders).newBoardState
  }
  for (let guard = 0; until && PHASE_ORDER[until.phase] !== undefined && roundRank(state) < roundRank(until) && guard < 1000; guard++) {
    frames.push({ board: state, orders: [] })
    state = adjudicate(map, state, []).newBoardState
  }
  frames.push({ board: state, orders: [] })
  return frames
}
