// Adjacency / path primitives. The engine routes all map-graph queries through
// here. Low-level reachability reuses the existing order-options helpers; the
// convoy chain search is shared with order entry via convoy.ts.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { reachable, reachableCoasts } from '../orders/options'
import { convoyChain } from './convoy'

/** Raw province adjacency (coast-collapsed), sorted. */
export const adjacentProvinces = (map: MapDefinition, province: string): string[] => {
  const t = map.territories[province]
  return t ? [...t.adjacent].sort() : []
}

/** Province ids a unit may legally move into directly (coasts collapsed). */
export const directReach = (map: MapDefinition, unit: Unit): string[] => reachable(map, unit)

/** Whether `unit` may directly move into `dest` (ignoring occupancy/strength). */
export const canMoveDirect = (map: MapDefinition, unit: Unit, dest: string): boolean =>
  reachable(map, unit).includes(dest)

/** Named coasts of `target` a fleet from `from` may land on. */
export const landingCoasts = (map: MapDefinition, target: string, from: string): string[] =>
  reachableCoasts(map, target, from)

export const isSea = (map: MapDefinition, province: string): boolean =>
  map.territories[province]?.type === 'sea'

export const isCoastal = (map: MapDefinition, province: string): boolean =>
  map.territories[province]?.type === 'coast'

/**
 * Does a convoy path exist from coastal `from` to coastal `to`, hopping only
 * through sea provinces whose fleets are in `convoyFleets`? Multi-fleet aware.
 */
export const convoyPathExists = (
  map: MapDefinition,
  from: string,
  to: string,
  convoyFleets: Set<string>,
  /** Optional filter on the final hop (last convoying fleet -> destination). */
  lastHopOk: (sea: string) => boolean = () => true,
): boolean => {
  if (from === to) return false
  return [...convoyChain(map, from, convoyFleets)].some(
    (sea) => adjacentProvinces(map, sea).includes(to) && lastHopOk(sea),
  )
}
