// Which nations have no legal action in a given phase — used to auto-ready them so a
// phase with nothing for them to do doesn't block early resolution. Pure: computed
// from the board + map alone.

import type { MapDefinition } from '../mapDefinition'
import type { BoardState } from './types'
import { homeCenters, scCountByNation, unitCountByNation } from './state'

/**
 * Nations with nothing to do in `board.phase`, computed over every nation present on the
 * board (by unit or owned center). Including a power with no player is harmless — the
 * readiness check ignores inactive powers — so the caller can auto-ready all of these.
 *
 * - movement: only unit-less (eliminated) powers are idle; anyone with a unit can move/hold.
 * - retreat:  powers with no dislodged unit.
 * - build:    delta 0, or a surplus with no buildable home center (otherwise there's a
 *             build/disband choice to make).
 */
export function idleNations(map: MapDefinition, board: BoardState): string[] {
  const present = new Set<string>([
    ...board.units.map((u) => u.nation),
    ...Object.values(board.supplyCenters),
  ])
  const idle: string[] = []

  if (board.phase === 'retreat') {
    const needsRetreat = new Set(board.dislodged.map((d) => d.unit.nation))
    for (const n of present) if (!needsRetreat.has(n)) idle.push(n)
    return idle
  }

  if (board.phase === 'build') {
    const sc = scCountByNation(board.supplyCenters)
    const un = unitCountByNation(board.units)
    const occupied = new Set(board.units.map((u) => u.territory))
    for (const n of present) {
      const delta = (sc[n] ?? 0) - (un[n] ?? 0)
      if (delta < 0) continue // must disband — a choice to make
      if (delta > 0 && homeCenters(map, n).some((c) => board.supplyCenters[c] === n && !occupied.has(c))) {
        continue // can build — a choice to make
      }
      idle.push(n) // balanced, or a surplus with nowhere to build
    }
    return idle
  }

  // movement
  const withUnits = new Set(board.units.map((u) => u.nation))
  for (const n of present) if (!withUnits.has(n)) idle.push(n)
  return idle
}
