// Render an order in standard Diplomacy notation, e.g.
//   A Par - Bur      (move)        A Par H            (hold)
//   A Par S A Mar    (support hold) A Par S A Mar - Bur (support move)
//   F Eng C A Lon - Bel            (convoy)
// Province casing follows the project convention: seas ALL CAPS, land Title Case,
// coasts as Stp(sc).

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { AnyOrder, Order } from './types'
import { unitAt } from '../adjudicator/state'

type Dislodged = { unit: Unit }

/** The type letter (A/F) of the unit in a province, searching unit lists in priority order. */
const unitLetter = (province: string, ...lists: Unit[][]): string => {
  for (const list of lists) {
    const u = unitAt(list, province)
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

/** A movement-phase order in standard notation. */
export function formatOrder(map: MapDefinition, units: Unit[], o: Order): string {
  const a = unitLetter(o.source, units)
  const src = fmtProvince(map, o.source, o.sourceCoast)
  switch (o.type) {
    case 'Hold':
      return `${a} ${src} H`
    case 'Move':
      return `${a} ${src} - ${fmtProvince(map, o.target ?? '', o.targetCoast)}`
    case 'Support': {
      const aux = unitLetter(o.aux ?? '', units)
      const auxP = fmtProvince(map, o.aux ?? '')
      return o.target && o.target !== o.aux
        ? `${a} ${src} S ${aux} ${auxP} - ${fmtProvince(map, o.target)}`
        : `${a} ${src} S ${aux} ${auxP}`
    }
    case 'Convoy': {
      const aux = unitLetter(o.aux ?? '', units)
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
      const a = unitLetter(o.source, dislodged.map((d) => d.unit), units)
      return `${a} ${fmtProvince(map, o.source, o.sourceCoast)} - ${fmtProvince(map, o.target ?? '', o.targetCoast)}`
    }
    case 'Disband': {
      const a = unitLetter(o.source, dislodged.map((d) => d.unit), units)
      return `${a} ${fmtProvince(map, o.source, o.sourceCoast)} D`
    }
    case 'Build': {
      const a = o.unitType === 'fleet' ? 'F' : 'A'
      return `Build ${a} ${fmtProvince(map, o.source, o.sourceCoast)}`
    }
    case 'Remove': {
      const a = unitLetter(o.source, units)
      return `Remove ${a} ${fmtProvince(map, o.source, o.sourceCoast)}`
    }
  }
}

/** A province's full name, with its coast spelled out ("Spain (South Coast)"). */
function placeName(map: MapDefinition, id: string, coast?: string): string {
  const t = map.territories[id]
  const name = t?.name ?? id
  return coast ? `${name} (${t?.coasts?.[coast]?.name ?? coast.toUpperCase()})` : name
}

/**
 * The same orders in plain words, for readers who don't speak notation:
 * "London → English Channel", "Edinburgh supports London → North Sea",
 * "Build a fleet in St. Petersburg (South Coast)".
 */
export function describeAnyOrder(map: MapDefinition, o: AnyOrder): string {
  const src = placeName(map, o.source, o.sourceCoast)
  switch (o.type) {
    case 'Hold':
      return `${src} holds`
    case 'Move':
    case 'Retreat':
      return `${src} → ${placeName(map, o.target ?? '', o.targetCoast)}${o.type === 'Retreat' ? ' (retreat)' : ''}`
    case 'Support':
      return o.target && o.target !== o.aux
        ? `${src} supports ${placeName(map, o.aux ?? '')} → ${placeName(map, o.target)}`
        : `${src} supports ${placeName(map, o.aux ?? '')} holding`
    case 'Convoy':
      return `${src} convoys ${placeName(map, o.aux ?? '')} → ${placeName(map, o.target ?? '')}`
    case 'Disband':
      return `${src} disbands`
    case 'Build':
      return `Build ${o.unitType === 'fleet' ? 'a fleet' : 'an army'} in ${src}`
    case 'Remove':
      return `Remove the unit in ${src}`
  }
}
