// Phase dispatcher + phase progression. `adjudicate` resolves the board's current
// phase and returns a new board advanced to the next phase that actually has work
// (no-op retreat/build phases are skipped; a dislodged unit with no retreat disbands at once).

import type { MapDefinition } from '../mapDefinition'
import type { Order } from '../orders/types'
import type { Unit } from '../types'
import type {
  AdjudicationResult,
  AnyOrder,
  BoardState,
  BuildOrder,
  RetreatOrder,
  Season,
} from './types'
import { resolveMovement } from './movement'
import { resolveRetreat, retreatTargets } from './retreat'
import { resolveBuild } from './build'
import {
  recomputeSupplyCenters,
  scCountByNation,
  supplyCenterProvinces,
} from './state'
import { nationsOf } from './rules'
import { isIdle } from './idle'

export function adjudicate(
  map: MapDefinition,
  board: BoardState,
  orders: AnyOrder[],
): AdjudicationResult {
  switch (board.phase) {
    case 'movement': {
      const out = resolveMovement(map, board, orders as Order[])
      // A dislodged unit with nowhere to retreat can only disband, so it is removed now
      // rather than holding a retreat phase open for a choice nobody has.
      const occupied = new Set(out.units.map((u) => u.territory))
      const dislodged = out.dislodged.filter(
        (d) => retreatTargets(map, d.unit, d.attackedFrom, occupied, out.contested).length > 0,
      )
      const next =
        dislodged.length > 0
          ? {
              phase: 'retreat' as const,
              season: board.season,
              year: board.year,
              units: out.units,
              supplyCenters: board.supplyCenters,
              dislodged,
              contested: out.contested,
            }
          : advanceAfterRetreats(map, board.season, board.year, out.units, board.supplyCenters)
      return finalize(map, { ...board, ...next, mapId: board.mapId }, out.results)
    }
    case 'retreat': {
      const out = resolveRetreat(map, board, orders as RetreatOrder[])
      const next = advanceAfterRetreats(map, board.season, board.year, out.units, board.supplyCenters)
      return finalize(map, { ...board, ...next, mapId: board.mapId }, out.results)
    }
    case 'build': {
      const out = resolveBuild(map, board, orders as BuildOrder[])
      const next: BoardState = {
        mapId: board.mapId,
        phase: 'movement',
        season: 'Spring',
        year: board.year + 1,
        units: out.units,
        supplyCenters: board.supplyCenters,
        dislodged: [],
        contested: [],
      }
      return finalize(map, next, out.results)
    }
  }
}

/** Transition out of a fully-resolved movement+retreat: Spring→Fall, or Fall→build/next year. */
function advanceAfterRetreats(
  map: MapDefinition,
  season: Season,
  year: number,
  units: Unit[],
  owners: Record<string, string>,
): Pick<BoardState, 'phase' | 'season' | 'year' | 'units' | 'supplyCenters' | 'dislodged' | 'contested'> {
  if (season === 'Spring') {
    return { phase: 'movement', season: 'Fall', year, units, supplyCenters: owners, dislodged: [], contested: [] }
  }
  // Fall complete — supply centers change hands now.
  const newOwners = recomputeSupplyCenters(map, units, owners)
  // A build phase opens only when some power has a choice in it (isIdle): builds owed
  // with somewhere to build, removals owed, or (conversion) a unit that may switch type.
  // A surplus with no free build site resolves to no change, so it is skipped like any
  // other no-op phase.
  const build = { phase: 'build' as const, season: 'Fall' as const, year, units, supplyCenters: newOwners, dislodged: [], contested: [] }
  if (nationsOf(newOwners, units).some((n) => !isIdle(map, build, n))) return build
  return { phase: 'movement', season: 'Spring', year: year + 1, units, supplyCenters: newOwners, dislodged: [], contested: [] }
}

function finalize(
  map: MapDefinition,
  next: BoardState,
  results: AdjudicationResult['results'],
): AdjudicationResult {
  return { newBoardState: next, results, victory: victoryFor(map, next.supplyCenters) }
}

/** Centers a power needs for a solo win: the map's own target, else a bare majority. */
export function victoryThreshold(map: MapDefinition): number {
  return map.victoryCenters ?? Math.floor(supplyCenterProvinces(map).length / 2) + 1
}

/** The winner, if any, given supply-center ownership and the map's victory rule. */
export function victoryFor(map: MapDefinition, owners: Record<string, string>): AdjudicationResult['victory'] {
  const sc = scCountByNation(owners)
  const threshold = victoryThreshold(map)
  let victory: AdjudicationResult['victory']
  for (const [nation, centers] of Object.entries(sc)) {
    if (centers >= threshold && (!victory || centers > victory.centers)) {
      victory = { nation, centers }
    }
  }
  // Shared victory (Era of Empire): every power tied for the most centers shares the win.
  if (victory && map.rules?.sharedVictory) {
    const lead = victory
    const tied = Object.entries(sc).filter(([, c]) => c === lead.centers).map(([n]) => n).sort()
    victory = tied.length > 1 ? { nation: tied[0], centers: lead.centers, shared: tied } : { nation: lead.nation, centers: lead.centers }
  }
  // Strict victory (1900): the leader must hold more centers than every other power.
  if (victory && map.rules?.strictVictory) {
    const lead = victory
    if (Object.entries(sc).some(([n, c]) => n !== lead.nation && c >= lead.centers)) victory = undefined
  }
  return victory
}
