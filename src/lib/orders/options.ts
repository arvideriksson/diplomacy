// Derives plausible order options from the map's own adjacency data
// (territory.adjacent for armies; territory.fleetAdjacent / coasts[].fleetAdjacency
// for fleets). This is a client-side approximation of legality for order entry —
// final adjudication would belong to a game engine.
import type { MapDefinition, TerritoryDefinition } from '../mapDefinition'
import { canArmyEnter, canFleetEnter } from '../mapDefinition'
import type { Unit } from '../types'

type Def = MapDefinition

const territory = (map: Def, id: string): TerritoryDefinition | undefined =>
  map.territories[id]

/** Province ids a unit can move into (coast distinctions collapsed to provinces). */
export const reachable = (map: Def, unit: Unit): string[] => {
  const t = territory(map, unit.territory)
  if (!t) return []
  if (unit.type === 'army') {
    return t.adjacent.filter((id) => {
      const adj = territory(map, id)
      return adj ? canArmyEnter(adj) : false
    })
  }
  // fleet
  if (unit.coast && t.coasts?.[unit.coast]) {
    return [...t.coasts[unit.coast].fleetAdjacency]
  }
  // Single-coast coastal provinces carry explicit sea-border adjacency: a fleet
  // may follow the coast, not every land-adjacent neighbour (F Gas can't reach Mar).
  if (t.fleetAdjacent) return [...t.fleetAdjacent]
  // Seas (and any province lacking explicit fleet adjacency): adjacency is already
  // all sea-reachable, so fall back to the type filter.
  return t.adjacent.filter((id) => {
    const adj = territory(map, id)
    return adj ? canFleetEnter(adj) : false
  })
}

/** Which named coasts of `target` a fleet coming from `from` may land on. */
export const reachableCoasts = (map: Def, target: string, from: string): string[] => {
  const t = territory(map, target)
  if (!t?.coasts) return []
  return Object.entries(t.coasts)
    .filter(([, coast]) => coast.fleetAdjacency.includes(from))
    .map(([id]) => id)
}

export interface MoveTarget {
  province: string
  /** Coasts requiring a choice; empty when the target has none or is auto-resolved. */
  coasts: string[]
}

/** Legal Move destinations for a unit, with any coast choices attached. */
export const moveTargets = (map: Def, unit: Unit): MoveTarget[] => {
  const out: MoveTarget[] = []
  for (const province of reachable(map, unit)) {
    const t = territory(map, province)
    if (!t) continue
    if (unit.type === 'fleet' && t.coasts) {
      const coasts = reachableCoasts(map, province, unit.territory)
      if (coasts.length === 0) continue // not actually reachable by sea
      out.push({ province, coasts })
    } else {
      out.push({ province, coasts: [] })
    }
  }
  return out
}

const reachableSet = (map: Def, unit: Unit): Set<string> => new Set(reachable(map, unit))

/** Units that `supporter` could support (hold or move), with the actions available. */
export const supportAux = (map: Def, supporter: Unit, units: Unit[]): string[] => {
  const reach = reachableSet(map, supporter)
  return units
    .filter((u) => u !== supporter)
    .filter((u) => reach.has(u.territory) || reachable(map, u).some((p) => reach.has(p)))
    .map((u) => u.territory)
}

/**
 * Destinations the supporter can support `aux` into. Includes `aux`'s own province
 * (a support-hold) when the supporter is adjacent to it.
 */
export const supportTargets = (
  map: Def,
  supporter: Unit,
  aux: Unit,
  _units: Unit[]
): string[] => {
  const reach = reachableSet(map, supporter)
  const targets = reachable(map, aux).filter((p) => reach.has(p))
  if (reach.has(aux.territory)) targets.push(aux.territory) // support hold
  return [...new Set(targets)]
}

/** Armies a convoying fleet (in a sea) can pick up: coastal armies beside the fleet. */
export const convoyAux = (map: Def, fleet: Unit, units: Unit[]): string[] => {
  const fleetT = territory(map, fleet.territory)
  if (!fleetT || fleetT.type !== 'sea') return []
  const beside = new Set(fleet.territory ? fleetT.adjacent : [])
  return units
    .filter((u) => u.type === 'army' && beside.has(u.territory))
    .map((u) => u.territory)
}

/** Coastal provinces the fleet can convoy `aux` to (single-fleet hop). */
export const convoyTargets = (map: Def, fleet: Unit, aux: Unit): string[] => {
  const fleetT = territory(map, fleet.territory)
  if (!fleetT) return []
  return fleetT.adjacent.filter((id) => {
    const t = territory(map, id)
    return Boolean(t && t.type === 'coast' && id !== aux.territory)
  })
}
