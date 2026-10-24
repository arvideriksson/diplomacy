// Internal consistency of every registered map's adjacency graph: references resolve,
// army and fleet edges are symmetric, and fleet edges are also general edges.
import { describe, expect, it } from 'vitest'
import type { TerritoryDefinition } from '../mapDefinition'
import { maps } from './index'

/** Effective fleet neighbours: a sea's `adjacent`, the union of a split-coast province's
 *  per-coast `fleetAdjacency`, or a single-coast province's `fleetAdjacent`. */
function fleetNeighbors(t: TerritoryDefinition): string[] {
  if (t.type === 'sea') return t.adjacent
  if (t.coasts) return [...new Set(Object.values(t.coasts).flatMap((c) => c.fleetAdjacency))]
  return t.fleetAdjacent ?? []
}

for (const [mapId, map] of Object.entries(maps)) {
  describe(`${mapId} adjacency`, () => {
    const T = map.territories
    const ids = Object.keys(T)

    it('references only known provinces', () => {
      const missing = ids.flatMap((id) =>
        [...new Set([...T[id].adjacent, ...fleetNeighbors(T[id])])].filter((n) => !T[n]).map((n) => `${id}->${n}`),
      )
      expect(missing).toEqual([])
    })

    it('has symmetric general adjacency', () => {
      const asym = ids.flatMap((id) =>
        T[id].adjacent.filter((n) => T[n] && !T[n].adjacent.includes(id)).map((n) => `${id}->${n}`),
      )
      expect(asym).toEqual([])
    })

    it('has symmetric fleet adjacency', () => {
      const asym = ids.flatMap((id) =>
        fleetNeighbors(T[id]).filter((n) => T[n] && !fleetNeighbors(T[n]).includes(id)).map((n) => `${id}->${n}`),
      )
      expect(asym).toEqual([])
    })

    it('keeps every fleet edge in the general adjacency', () => {
      const stray = ids.flatMap((id) =>
        fleetNeighbors(T[id]).filter((n) => !T[id].adjacent.includes(n)).map((n) => `${id}->${n}`),
      )
      expect(stray).toEqual([])
    })
  })
}
