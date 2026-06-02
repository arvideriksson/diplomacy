// Entry-time option helpers for the retreat and build phases — the client-side
// counterpart to options.ts (which covers movement). These derive legal choices
// from the map graph + board state; final legality is still the adjudicator's.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { reachable, reachableCoasts, type MoveTarget } from './options'

/**
 * Legal retreat destinations for a dislodged unit: reachable provinces that are
 * unoccupied, not the province the dislodging attack came from, and not a standoff
 * (contested) square. `attackedFrom` may be empty when dislodged by a convoy.
 */
export function retreatTargets(
  map: MapDefinition,
  unit: Unit,
  attackedFrom: string,
  units: Unit[],
  contested: string[],
): MoveTarget[] {
  const occupied = new Set(units.map((u) => u.territory))
  const out: MoveTarget[] = []
  for (const province of reachable(map, unit)) {
    if (occupied.has(province)) continue
    if (province === attackedFrom) continue
    if (contested.includes(province)) continue
    const t = map.territories[province]
    if (unit.type === 'fleet' && t?.coasts) {
      const coasts = reachableCoasts(map, province, unit.territory)
      if (coasts.length === 0) continue
      out.push({ province, coasts })
    } else {
      out.push({ province, coasts: [] })
    }
  }
  return out
}

export interface BuildSpot {
  province: string
  /** Unit types that may be built here. */
  types: Array<'army' | 'fleet'>
  /** Named coasts to choose from for a fleet (multi-coast provinces only). */
  coasts?: string[]
}

export interface BuildSituation {
  /** Supply-center count minus unit count: >0 builds owed, <0 removals owed. */
  delta: number
  /** Where the nation may build (only relevant when delta > 0). */
  spots: BuildSpot[]
  /** The nation's units, any of which may be removed (relevant when delta < 0). */
  removable: Unit[]
}

/** Compute a nation's build/disband situation for the current board. */
export function buildSituation(
  map: MapDefinition,
  nation: string,
  owners: Record<string, string>,
  units: Unit[],
): BuildSituation {
  const scCount = Object.values(owners).filter((n) => n === nation).length
  const myUnits = units.filter((u) => u.nation === nation)
  const occupied = new Set(units.map((u) => u.territory))

  const spots: BuildSpot[] = []
  const homes = Object.entries(map.territories)
    .filter(([, t]) => t.supplyCenter && t.homePower === nation)
    .map(([id]) => id)
    .sort()
  for (const sc of homes) {
    if (owners[sc] !== nation || occupied.has(sc)) continue
    const t = map.territories[sc]
    const types: Array<'army' | 'fleet'> = ['army']
    if (t.type === 'coast') types.push('fleet')
    spots.push({ province: sc, types, coasts: t.coasts ? Object.keys(t.coasts) : undefined })
  }

  return { delta: scCount - myUnits.length, spots, removable: myUnits }
}
