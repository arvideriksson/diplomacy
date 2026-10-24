// Adjacency / path primitives. The engine routes all map-graph queries through
// here. Low-level reachability reuses the existing order-options helpers; the
// multi-fleet convoy-path BFS is the one primitive options.ts lacks.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { reachable, reachableCoasts } from '../orders/options'

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
  const seasAdjTo = (p: string) => adjacentProvinces(map, p).includes(to) && lastHopOk(p)
  const frontier = adjacentProvinces(map, from).filter((s) => convoyFleets.has(s))
  const visited = new Set<string>(frontier)
  const queue = [...frontier].sort()
  while (queue.length) {
    const s = queue.shift()!
    if (seasAdjTo(s)) return true
    for (const n of adjacentProvinces(map, s)) {
      if (convoyFleets.has(n) && !visited.has(n)) {
        visited.add(n)
        queue.push(n)
      }
    }
  }
  return false
}
