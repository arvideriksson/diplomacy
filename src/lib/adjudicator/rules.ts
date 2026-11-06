// Variant-rule helpers (MapDefinition.rules). Every helper is a no-op on maps
// without the corresponding rule, so the classical board resolves exactly as before.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { homeCenters, scCountByNation, sortIds, supplyCenterProvinces } from './state'

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

/** The supply centers `nation` owns, sorted. */
export const ownedCenters = (map: MapDefinition, nation: string, owners: Record<string, string>): string[] =>
  supplyCenterProvinces(map).filter((p) => owners[p] === nation)

/**
 * Provinces where `nation` may build this adjustment phase: its owned, unoccupied home
 * centers (any owned center under conscription), plus the emergency site.
 */
export const buildSites = (map: MapDefinition, nation: string, owners: Record<string, string>, units: Unit[]): string[] => {
  const occupied = new Set(units.map((u) => u.territory))
  const centers = map.rules?.buildAnyCenter ? ownedCenters(map, nation, owners) : homeCenters(map, nation)
  const sites = centers.filter((h) => owners[h] === nation && !occupied.has(h))
  const e = map.rules?.emergency
  if (e && emergencyActive(map, nation, owners) && !occupied.has(e.buildSite)) sites.push(e.buildSite)
  return sortIds(sites)
}

/**
 * Centers civil-disorder removals count distance from: the home centers (plus any variant
 * extras), or every owned center under conscription.
 */
export const disorderHomes = (map: MapDefinition, nation: string, owners: Record<string, string>): string[] =>
  map.rules?.buildAnyCenter
    ? ownedCenters(map, nation, owners)
    : sortIds([...homeCenters(map, nation), ...(map.rules?.disorderHomes?.[nation] ?? [])])

/** The unit type `unit` could convert into where it stands, if conversion allows one. */
export const conversionTarget = (map: MapDefinition, unit: Unit, owners: Record<string, string>): 'army' | 'fleet' | null => {
  if (!map.rules?.conversion) return null
  const t = map.territories[unit.territory]
  if (!t?.supplyCenter || owners[unit.territory] !== unit.nation) return null
  if (unit.type === 'fleet') return 'army'
  return t.type === 'coast' ? 'fleet' : null
}

/** `nation`'s units that may convert this build phase, sorted by province. */
export const convertibleUnits = (map: MapDefinition, nation: string, owners: Record<string, string>, units: Unit[]): Unit[] =>
  units.filter((u) => u.nation === nation && conversionTarget(map, u, owners)).sort((a, b) => (a.territory < b.territory ? -1 : 1))
