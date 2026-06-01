// Board-state helpers. Every function that returns a list returns it in canonical
// (province-sorted) order so the engine is deterministic across runs.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { BoardState } from './types'

export const sortIds = (ids: string[]): string[] => [...ids].sort()

export const sortUnits = (units: Unit[]): Unit[] =>
  [...units].sort((a, b) => (a.territory < b.territory ? -1 : a.territory > b.territory ? 1 : 0))

/** The unit standing in a province (coast-agnostic — one unit per province). */
export const unitAt = (units: Unit[], province: string): Unit | undefined =>
  units.find((u) => u.territory === province)

export const cloneBoard = (s: BoardState): BoardState => ({
  mapId: s.mapId,
  year: s.year,
  season: s.season,
  phase: s.phase,
  units: s.units.map((u) => ({ ...u })),
  supplyCenters: { ...s.supplyCenters },
  dislodged: s.dislodged.map((d) => ({ unit: { ...d.unit }, attackedFrom: d.attackedFrom })),
  contested: [...s.contested],
})

/** All supply-center province ids on the map, sorted. */
export const supplyCenterProvinces = (map: MapDefinition): string[] =>
  sortIds(Object.entries(map.territories).filter(([, t]) => t.supplyCenter).map(([id]) => id))

/** Home supply centers of a nation, sorted. */
export const homeCenters = (map: MapDefinition, nation: string): string[] =>
  sortIds(
    Object.entries(map.territories)
      .filter(([, t]) => t.supplyCenter && t.homePower === nation)
      .map(([id]) => id),
  )

/**
 * Recompute supply-center ownership from current occupancy: a unit standing on an
 * SC claims it for its nation; otherwise ownership persists. Run after Fall
 * retreats per the rules.
 */
export const recomputeSupplyCenters = (
  map: MapDefinition,
  units: Unit[],
  prior: Record<string, string>,
): Record<string, string> => {
  const owners: Record<string, string> = { ...prior }
  for (const id of supplyCenterProvinces(map)) {
    const u = unitAt(units, id)
    if (u) owners[id] = u.nation
  }
  return owners
}

export const scCountByNation = (owners: Record<string, string>): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const nation of Object.values(owners)) counts[nation] = (counts[nation] ?? 0) + 1
  return counts
}

export const unitCountByNation = (units: Unit[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const u of units) counts[u.nation] = (counts[u.nation] ?? 0) + 1
  return counts
}
