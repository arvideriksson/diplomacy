// Phase dispatcher + phase progression. `adjudicate` resolves the board's current
// phase and returns a new board advanced to the next phase that actually has work
// (no-op retreat/build phases are skipped).

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
import { resolveRetreat } from './retreat'
import { resolveBuild } from './build'
import {
  recomputeSupplyCenters,
  scCountByNation,
  supplyCenterProvinces,
  unitCountByNation,
} from './state'
import { nationsOf, unitAllowance } from './rules'

export function adjudicate(
  map: MapDefinition,
  board: BoardState,
  orders: AnyOrder[],
): AdjudicationResult {
  switch (board.phase) {
    case 'movement': {
      const out = resolveMovement(map, board, orders as Order[])
      const next =
        out.dislodged.length > 0
          ? {
              phase: 'retreat' as const,
              season: board.season,
              year: board.year,
              units: out.units,
              supplyCenters: board.supplyCenters,
              dislodged: out.dislodged,
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
  const uc = unitCountByNation(units)
  const needsAdjustment = nationsOf(newOwners, units).some((n) => unitAllowance(map, n, newOwners) !== (uc[n] ?? 0))
  if (needsAdjustment) {
    return { phase: 'build', season: 'Fall', year, units, supplyCenters: newOwners, dislodged: [], contested: [] }
  }
  return { phase: 'movement', season: 'Spring', year: year + 1, units, supplyCenters: newOwners, dislodged: [], contested: [] }
}

function finalize(
  map: MapDefinition,
  next: BoardState,
  results: AdjudicationResult['results'],
): AdjudicationResult {
  return { newBoardState: next, results, victory: victoryFor(map, next.supplyCenters) }
}

/** The winner, if any, given supply-center ownership and the map's victory rule. */
export function victoryFor(map: MapDefinition, owners: Record<string, string>): AdjudicationResult['victory'] {
  const sc = scCountByNation(owners)
  const threshold = map.victoryCenters ?? Math.floor(supplyCenterProvinces(map).length / 2) + 1
  let victory: AdjudicationResult['victory']
  for (const [nation, centers] of Object.entries(sc)) {
    if (centers >= threshold && (!victory || centers > victory.centers)) {
      victory = { nation, centers }
    }
  }
  // Strict victory (1900): the leader must hold more centers than every other power.
  if (victory && map.rules?.strictVictory) {
    const lead = victory
    if (Object.entries(sc).some(([n, c]) => n !== lead.nation && c >= lead.centers)) victory = undefined
  }
  return victory
}
