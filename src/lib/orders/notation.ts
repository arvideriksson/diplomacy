// Render an order in standard Diplomacy notation, e.g.
//   A Par - Bur      (move)        A Par H            (hold)
//   A Par S A Mar    (support hold) A Par S A Mar - Bur (support move)
//   F Eng C A Lon - Bel            (convoy)
// Province casing follows the project convention: seas ALL CAPS, land Title Case,
// coasts as Stp(sc).

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { AnyOrder, Order } from './types'

type Dislodged = { unit: Unit }

/** A unit's type letter (A/F), searching the given unit lists in priority order. */
const letterFrom = (lists: Unit[][], province: string): string => {
  for (const list of lists) {
    const u = list.find((x) => x.territory === province)
    if (u) return u.type === 'fleet' ? 'F' : 'A'
  }
  return ''
}

/** Format a province id (+ optional coast) per the casing convention. */
export function fmtProvince(map: MapDefinition, id: string, coast?: string): string {
  const t = map.territories[id]
  const base = t?.type === 'sea' ? id.toUpperCase() : id.charAt(0).toUpperCase() + id.slice(1).toLowerCase()
  return coast ? `${base}(${coast.toLowerCase()})` : base
}

const unitLetter = (units: Unit[], province: string): string => {
  const u = units.find((x) => x.territory === province)
  return u ? (u.type === 'fleet' ? 'F' : 'A') : ''
}

/** A movement-phase order in standard notation. */
export function formatOrder(map: MapDefinition, units: Unit[], o: Order): string {
  const a = unitLetter(units, o.source)
  const src = fmtProvince(map, o.source, o.sourceCoast)
  switch (o.type) {
    case 'Hold':
      return `${a} ${src} H`
    case 'Move':
      return `${a} ${src} - ${fmtProvince(map, o.target ?? '', o.targetCoast)}`
    case 'Support': {
      const aux = unitLetter(units, o.aux ?? '')
      const auxP = fmtProvince(map, o.aux ?? '')
      return o.target && o.target !== o.aux
        ? `${a} ${src} S ${aux} ${auxP} - ${fmtProvince(map, o.target)}`
        : `${a} ${src} S ${aux} ${auxP}`
    }
    case 'Convoy': {
      const aux = unitLetter(units, o.aux ?? '')
      return `${a} ${src} C ${aux} ${fmtProvince(map, o.aux ?? '')} - ${fmtProvince(map, o.target ?? '')}`
    }
  }
}

/**
 * Format any order — movement, retreat, or build — in standard notation. Needs the
 * pre-resolution board (units + dislodged) to recover unit types for the A/F prefix.
 */
export function formatAnyOrder(
  map: MapDefinition,
  units: Unit[],
  dislodged: Dislodged[],
  o: AnyOrder,
): string {
  switch (o.type) {
    case 'Hold':
    case 'Move':
    case 'Support':
    case 'Convoy':
      return formatOrder(map, units, o)
    case 'Retreat': {
      // the actor is the dislodged unit — a survivor may sit on the same province
      const a = letterFrom([dislodged.map((d) => d.unit), units], o.source)
      return `${a} ${fmtProvince(map, o.source, o.sourceCoast)} - ${fmtProvince(map, o.target ?? '', o.targetCoast)}`
    }
    case 'Disband': {
      const a = letterFrom([dislodged.map((d) => d.unit), units], o.source)
      return `${a} ${fmtProvince(map, o.source, o.sourceCoast)} D`
    }
    case 'Build': {
      const a = o.unitType === 'fleet' ? 'F' : 'A'
      return `Build ${a} ${fmtProvince(map, o.source, o.sourceCoast)}`
    }
    case 'Remove': {
      const a = letterFrom([units], o.source)
      return `Remove ${a} ${fmtProvince(map, o.source, o.sourceCoast)}`
    }
  }
}
