// Parser for the TedDriggs DATC corpus: the order-string DSL and `starting_state`
// entries, translated into our engine structures.

import type { Unit } from '../../types'
import type { Order } from '../../orders/types'
import type { AnyOrder, BuildOrder, Phase, RetreatOrder } from '../types'
import { toNation, toProvince } from './datc-codes'

export type CasePhase = 'Main' | 'Retreat' | 'Build'

const PHASE_MAP: Record<CasePhase, Phase> = {
  Main: 'movement',
  Retreat: 'retreat',
  Build: 'build',
}

export const casePhase = (p: CasePhase): Phase => PHASE_MAP[p]

export interface Loc {
  province: string
  coast?: string
}

/** Parse a unit location token: `nth` or `spa(nc)`. */
export function parseLoc(token: string): Loc {
  const m = token.match(/^([a-z]{3})(?:\(([a-z]{2})\))?$/i)
  if (!m) throw new Error(`Bad location token: ${token}`)
  return { province: toProvince(m[1]), coast: m[2]?.toLowerCase() }
}

export const unitType = (letter: string): Unit['type'] => (letter.toUpperCase() === 'F' ? 'fleet' : 'army')

/** A `starting_state` entry, e.g. "ENG: F lon" or "FRA: F spa(sc)". */
export function parseUnit(entry: string): Unit {
  const [nationCode, body] = splitNation(entry)
  const parts = body.split(/\s+/)
  const loc = parseLoc(parts[1])
  return {
    type: unitType(parts[0]),
    nation: toNation(nationCode),
    territory: loc.province,
    coast: loc.coast,
  }
}

export function splitNation(entry: string): [string, string] {
  const idx = entry.indexOf(':')
  if (idx < 0) throw new Error(`Order missing nation prefix: ${entry}`)
  return [entry.slice(0, idx).trim(), entry.slice(idx + 1).trim()]
}

/** Parse an order string in the context of a phase. */
export function parseOrder(phase: CasePhase, entry: string): AnyOrder {
  const [nationCode, body] = splitNation(entry)
  const nation = toNation(nationCode)
  const parts = body.split(/\s+/)
  const type = unitType(parts[0])
  const src = parseLoc(parts[1])
  const rest = parts.slice(2)
  const verb = rest[0]?.toLowerCase()

  if (phase === 'Build') {
    if (verb === 'build') {
      return { type: 'Build', nation, source: src.province, unitType: type, sourceCoast: src.coast } as BuildOrder
    }
    // "disband" / "remove" in a build phase
    return { type: 'Remove', nation, source: src.province, sourceCoast: src.coast } as BuildOrder
  }

  if (phase === 'Retreat') {
    if (verb === '->') {
      const dest = parseLoc(rest[1])
      return { type: 'Retreat', nation, source: src.province, sourceCoast: src.coast, target: dest.province, targetCoast: dest.coast } as RetreatOrder
    }
    return { type: 'Disband', nation, source: src.province, sourceCoast: src.coast } as RetreatOrder
  }

  // Main phase movement orders
  if (!verb || verb === 'hold' || verb === 'holds') {
    return { type: 'Hold', nation, source: src.province, sourceCoast: src.coast } as Order
  }
  if (verb === '->') {
    const dest = parseLoc(rest[1])
    // optional "via Convoy" / "via convoy" suffix marks an explicitly-convoyed move
    const viaConvoy = rest.slice(2).join(' ').toLowerCase() === 'via convoy'
    return { type: 'Move', nation, source: src.province, sourceCoast: src.coast, target: dest.province, targetCoast: dest.coast, viaConvoy } as Order
  }
  if (verb === 'supports') {
    const auxLoc = parseLoc(rest[2])
    if (rest[3]?.toLowerCase() === '->') {
      const dest = parseLoc(rest[4])
      return { type: 'Support', nation, source: src.province, sourceCoast: src.coast, aux: auxLoc.province, target: dest.province } as Order
    }
    return { type: 'Support', nation, source: src.province, sourceCoast: src.coast, aux: auxLoc.province, target: auxLoc.province } as Order
  }
  if (verb === 'convoys') {
    const auxLoc = parseLoc(rest[1])
    const dest = parseLoc(rest[3])
    return { type: 'Convoy', nation, source: src.province, aux: auxLoc.province, target: dest.province } as Order
  }
  throw new Error(`Unparseable order: ${entry}`)
}

/** Source province of any order (for matching results to expectations). */
export const orderSource = (o: AnyOrder): string => (o as { source: string }).source
