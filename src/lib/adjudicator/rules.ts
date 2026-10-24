// Variant-rule helpers (MapDefinition.rules). Every helper is a no-op on maps
// without the corresponding rule, so the classical board resolves exactly as before.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { homeCenters, scCountByNation, sortIds } from './state'

/** Whether a and b are joined by a long route (either direction). */
export const isLongRoute = (map: MapDefinition, a: string, b: string): boolean =>
  (map.rules?.longRoutes ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a))

/** Whether a fleet standing in `province` may convoy. */
export const canConvoyFrom = (map: MapDefinition, province: string): boolean =>
  map.territories[province]?.type === 'sea' || (map.rules?.convoyCoasts ?? []).includes(province)

/** Whether emergency measures are active for `nation` given current center ownership. */
export const emergencyActive = (map: MapDefinition, nation: string, owners: Record<string, string>): boolean => {
  const e = map.rules?.emergency
  if (!e || e.nation !== nation) return false
  const homes = homeCenters(map, nation)
  const held = homes.filter((h) => owners[h] === nation).length
  return held >= 1 && held < homes.length
}

/** Units a nation may keep: its center count, plus one under emergency measures. */
export const unitAllowance = (map: MapDefinition, nation: string, owners: Record<string, string>): number =>
  (scCountByNation(owners)[nation] ?? 0) + (emergencyActive(map, nation, owners) ? 1 : 0)

/** Every nation that owns a center or has a unit, sorted. */
export const nationsOf = (owners: Record<string, string>, units: Unit[]): string[] =>
  sortIds([...new Set([...Object.values(owners), ...units.map((u) => u.nation)])])

/** Provinces where `nation` may build this adjustment phase (owned, unoccupied home centers + emergency site). */
export const buildSites = (map: MapDefinition, nation: string, owners: Record<string, string>, units: Unit[]): string[] => {
  const occupied = new Set(units.map((u) => u.territory))
  const sites = homeCenters(map, nation).filter((h) => owners[h] === nation && !occupied.has(h))
  const e = map.rules?.emergency
  if (e && emergencyActive(map, nation, owners) && !occupied.has(e.buildSite)) sites.push(e.buildSite)
  return sortIds(sites)
}

/** Home centers used when choosing civil-disorder removals. */
export const disorderHomes = (map: MapDefinition, nation: string): string[] =>
  sortIds([...homeCenters(map, nation), ...(map.rules?.disorderHomes?.[nation] ?? [])])
