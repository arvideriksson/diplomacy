// Adjacency / path primitives. The engine routes all map-graph queries through
// here. Low-level reachability and the convoy chain reuse the order-options helpers, so
// order entry and adjudication agree.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { reachable, reachableCoasts, convoyChain } from '../orders/options'

/** Raw province adjacency (coast-collapsed), sorted. */
const adjacentProvinces = (map: MapDefinition, province: string): string[] => {
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
  for (const sea of convoyChain(map, from, convoyFleets)) {
    if (adjacentProvinces(map, sea).includes(to) && lastHopOk(sea)) return true
  }
  return false
}
