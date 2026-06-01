// Event sourcing: the authoritative board is the result of folding `adjudicate`
// over the ordered log of resolved rounds. Because `adjudicate` is pure and
// deterministic, replaying the log always reproduces the same state.

import type { MapDefinition } from '../mapDefinition'
import type { AnyOrder, BoardState } from './types'

export interface ResolvedRound {
  phase: BoardState['phase']
  season: BoardState['season']
  year: number
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
