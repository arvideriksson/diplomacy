// Public surface of the pure Diplomacy adjudicator engine. Isomorphic and
// dependency-free: safe to import from the browser (Vite) and from a Supabase
// Edge Function (Deno). Never import browser/Node-coupled modules here.

export { adjudicate } from './resolve'
export { idleNations } from './idle'
export { foldGame } from './fold'
export type { ResolvedRound } from './fold'
export type {
  AdjudicationResult,
  AnyOrder,
  BoardState,
  BuildOrder,
  DislodgedUnit,
  OrderResult,
  Phase,
  ResultCode,
  RetreatOrder,
  Season,
} from './types'

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { BoardState, Phase, Season } from './types'
import { recomputeSupplyCenters, sortUnits } from './state'

/** Seed SC ownership from home powers, then current occupancy. */
function seedOwnership(map: MapDefinition, units: Unit[]): Record<string, string> {
  const owners: Record<string, string> = {}
  for (const [id, t] of Object.entries(map.territories)) {
    if (t.supplyCenter && t.homePower) owners[id] = t.homePower
  }
  return recomputeSupplyCenters(map, units, owners)
}

/**
 * Reconstruct a board from a bare unit list (used for the first movement phase,
 * before any snapshot exists). Once a snapshot exists, deserialize that instead.
 */
export function boardFromUnits(
  map: MapDefinition,
  units: Unit[],
  year: number,
  season: Season,
  phase: Phase,
): BoardState {
  return {
    mapId: map.id,
    year,
    season,
    phase,
    units: sortUnits(units),
    supplyCenters: seedOwnership(map, units),
    dislodged: [],
    contested: [],
  }
}

/** Build the opening board for a map: starting units + home-center ownership. */
export function initialBoard(map: MapDefinition): BoardState {
  const units = map.startingUnits.map((u) => ({
    type: u.type,
    nation: u.power,
    territory: u.territory,
    coast: u.coast,
  }))
  // seed SC ownership from home powers, then from occupancy
  const owners: Record<string, string> = {}
  for (const [id, t] of Object.entries(map.territories)) {
    if (t.supplyCenter && t.homePower) owners[id] = t.homePower
  }
  return {
    mapId: map.id,
    year: 1901,
    season: 'Spring',
    phase: 'movement',
    units: sortUnits(units),
    supplyCenters: recomputeSupplyCenters(map, units, owners),
    dislodged: [],
    contested: [],
  }
}
