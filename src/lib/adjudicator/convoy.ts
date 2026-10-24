// Convoy-chain primitives shared by the engine (graph.ts, movement.ts) and order
// entry (orders/options.ts). Depends only on the map, so options.ts can import it
// without pulling in graph.ts (which itself imports options.ts).

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { canConvoyFrom } from './rules'

/** Provinces holding a fleet that may convoy (seas, plus variant convoy coasts). */
export const convoyFleets = (map: MapDefinition, units: Unit[]): Set<string> =>
  new Set(units.filter((u) => u.type === 'fleet' && canConvoyFrom(map, u.territory)).map((u) => u.territory))

/**
 * Every fleet province reachable from `from` by a chain of fleets in `fleets`: the
 * fleets beside `from`, plus any fleet adjacent to one already on the chain.
 */
export const convoyChain = (map: MapDefinition, from: string, fleets: Set<string>): Set<string> => {
  const seen = new Set<string>()
  const queue = (map.territories[from]?.adjacent ?? []).filter((p) => fleets.has(p))
  queue.forEach((p) => seen.add(p))
  while (queue.length) {
    const p = queue.shift()!
    for (const n of map.territories[p]?.adjacent ?? []) {
      if (fleets.has(n) && !seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
    }
  }
  return seen
}
