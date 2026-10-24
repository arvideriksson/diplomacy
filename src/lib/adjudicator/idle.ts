// Which nations have no legal action in a given phase — used to auto-ready them so a
// phase with nothing for them to do doesn't block early resolution. Pure: computed
// from the board + map alone.

import type { MapDefinition } from '../mapDefinition'
import type { BoardState } from './types'
import { unitCountByNation } from './state'
import { buildSites, unitAllowance } from './rules'

type IdleBoard = Pick<BoardState, 'phase' | 'units' | 'supplyCenters' | 'dislodged'>

/**
 * Whether `nation` has nothing to do in `board.phase`:
 *
 * - movement: only unit-less (eliminated) powers are idle; anyone with a unit can move/hold.
 * - retreat:  powers with no dislodged unit.
 * - build:    delta 0, or a surplus with no buildable home center (otherwise there's a
 *             build/disband choice to make).
 *
 * The client uses this directly to show "Waiting…" instead of a Submit button.
 */
export function isIdle(map: MapDefinition, board: IdleBoard, nation: string): boolean {
  if (board.phase === 'retreat') return !board.dislodged.some((d) => d.unit.nation === nation)

  if (board.phase === 'build') {
    // Allowance includes variant extras (1900 Russian emergency measures).
    const delta = unitAllowance(map, nation, board.supplyCenters) - (unitCountByNation(board.units)[nation] ?? 0)
    if (delta < 0) return false // must disband — a choice to make
    // A surplus is a choice only if there is somewhere to build.
    return delta === 0 || buildSites(map, nation, board.supplyCenters, board.units).length === 0
  }

  // movement
  return !board.units.some((u) => u.nation === nation)
}

/**
 * Nations idle in `board.phase` (see isIdle), over every nation present on the board
 * (by unit or owned center). Including a power with no player is harmless — the
 * readiness check ignores inactive powers — so the caller can auto-ready all of these.
 */
export function idleNations(map: MapDefinition, board: IdleBoard): string[] {
  const present = new Set<string>([
    ...board.units.map((u) => u.nation),
    ...Object.values(board.supplyCenters),
  ])
  return [...present].filter((n) => isIdle(map, board, n))
}
