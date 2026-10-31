// Derives plausible order options from the map's own adjacency data
// (territory.adjacent for armies; territory.fleetAdjacent / coasts[].fleetAdjacency
// for fleets). This is a client-side approximation of legality for order entry —
// final adjudication would belong to a game engine.
import type { MapDefinition, TerritoryDefinition } from '../mapDefinition'
import { canArmyEnter, canFleetEnter } from '../mapDefinition'
import type { Unit } from '../types'
import { canConvoyFrom, isLongRoute } from '../adjudicator/rules'
import { convoyChain, convoyFleets } from '../adjudicator/convoy'

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

/**
 * Coastal provinces an army in `from` could be convoyed to through chains of
 * fleets currently standing in convoy-capable provinces (seas, plus variant
 * convoy coasts such as 1900 Gibraltar). `through`, if given, must be on the chain.
 */
export const convoyReach = (map: Def, from: string, units: Unit[], through?: string): string[] => {
  const fleetAt = convoyFleets(map, units)
  if (territory(map, from)?.type !== 'coast') return []
  const seen = convoyChain(map, from, fleetAt)
  if (through && !seen.has(through)) return []
  const out = new Set<string>()
  for (const sea of seen) {
    for (const n of territory(map, sea)?.adjacent ?? []) {
      const t = territory(map, n)
      if (t && t.type === 'coast' && n !== from && !fleetAt.has(n)) out.add(n)
    }
  }
  return [...out].sort()
}

/**
 * One step of building an army's convoy route fleet by fleet. Given the army's
 * province and the fleets chosen so far, returns the fleet-held provinces that can
 * extend the chain and the coastal provinces the army could be landed on from the
 * last fleet. With an empty path only the first fleets (beside the army) are offered.
 */
export const convoyNext = (
  map: Def,
  army: string,
  path: string[],
  units: Unit[],
): { fleets: string[]; destinations: string[] } => {
  const fleetAt = convoyFleets(map, units)
  if (territory(map, army)?.type !== 'coast') return { fleets: [], destinations: [] }
  const last = path.at(-1) ?? army
  const around = territory(map, last)?.adjacent ?? []
  const landings = (p: string) =>
    (territory(map, p)?.adjacent ?? []).filter((n) => territory(map, n)?.type === 'coast' && n !== army && !path.includes(n) && n !== p && !fleetAt.has(n))
  // A fleet is offered only if it can carry the army somewhere from there.
  const fleets = around.filter((p) => fleetAt.has(p) && p !== army && !path.includes(p) && landings(p).length > 0)
  const destinations = path.length ? landings(last) : []
  return { fleets: [...fleets].sort(), destinations: [...destinations].sort() }
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

/** Where a unit can give support: its reach, minus long routes (1900 Suez rules 4–5). */
const supportReach = (map: Def, unit: Unit): Set<string> =>
  new Set(reachable(map, unit).filter((p) => !isLongRoute(map, unit.territory, p)))

/** Units that `supporter` could support (hold or move), with the actions available. */
export const supportAux = (map: Def, supporter: Unit, units: Unit[]): string[] => {
  const reach = supportReach(map, supporter)
  const others = units.filter((u) => u !== supporter)
  return others
    .filter(
      (u) =>
        reach.has(u.territory) ||
        reachable(map, u).some((p) => reach.has(p)) ||
        // An army convoyed into a province the supporter reaches (a supporting fleet can't also carry it).
        (u.type === 'army' && convoyReach(map, u.territory, others).some((p) => reach.has(p))),
    )
    .map((u) => u.territory)
}

/**
 * One step of picking, fleet by fleet, the convoy route of an army whose move
 * `supporter` supports. Like `convoyNext`, but a fleet is offered only if the chain
 * through it can still land the army in a province the supporter reaches, and only
 * such landings are offered. The supporter itself never carries the army.
 */
export const supportConvoyNext = (
  map: Def,
  supporter: Unit,
  army: Unit,
  path: string[],
  units: Unit[],
): { fleets: string[]; destinations: string[] } => {
  if (army.type !== 'army') return { fleets: [], destinations: [] }
  const reach = supportReach(map, supporter)
  const others = units.filter((u) => u !== supporter)
  const fleetAt = convoyFleets(map, others)
  const into = (sea: string) =>
    (territory(map, sea)?.adjacent ?? []).filter((n) => reach.has(n) && n !== army.territory && !fleetAt.has(n))
  // Whether a chain continuing through `fleet` (avoiding the fleets already chosen) lands in reach.
  const leadsInto = (fleet: string): boolean => {
    const seen = new Set([fleet])
    const queue = [fleet]
    while (queue.length) {
      const p = queue.shift()!
      if (into(p).length) return true
      for (const n of territory(map, p)?.adjacent ?? []) {
        if (fleetAt.has(n) && !seen.has(n) && !path.includes(n) && n !== army.territory) {
          seen.add(n)
          queue.push(n)
        }
      }
    }
    return false
  }
  const next = convoyNext(map, army.territory, path, others)
  const last = path.at(-1)
  return {
    fleets: next.fleets.filter(leadsInto),
    destinations: last ? into(last).sort() : [],
  }
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
  const reach = supportReach(map, supporter)
  const targets = reachable(map, aux).filter((p) => reach.has(p))
  if (reach.has(aux.territory)) targets.push(aux.territory) // support hold
  return [...new Set(targets)]
}

/** Armies a convoying fleet (in a sea) can pick up: coastal armies beside the fleet. */
export const convoyAux = (map: Def, fleet: Unit, units: Unit[]): string[] => {
  const fleetT = territory(map, fleet.territory)
  if (!fleetT || !canConvoyFrom(map, fleet.territory)) return []
  const beside = new Set(fleet.territory ? fleetT.adjacent : [])
  // Armies beside the fleet, or further away along a chain of fleets through this one.
  return units
    .filter((u) => u.type === 'army' && (beside.has(u.territory) || convoyReach(map, u.territory, units, fleet.territory).length > 0))
    .map((u) => u.territory)
}

/**
 * Coastal provinces the fleet can convoy `aux` to: beside the fleet, or further
 * along a chain of fleets that includes this one.
 */
export const convoyTargets = (map: Def, fleet: Unit, aux: Unit, units: Unit[] = []): string[] => {
  const fleetT = territory(map, fleet.territory)
  if (!fleetT) return []
  const beside = fleetT.adjacent.filter((id) => {
    const t = territory(map, id)
    return Boolean(t && t.type === 'coast' && id !== aux.territory)
  })
  const chained = convoyReach(map, aux.territory, units.some((u) => u.territory === fleet.territory) ? units : [...units, fleet], fleet.territory)
  return [...new Set([...beside, ...chained])].sort()
}
