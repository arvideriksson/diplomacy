// The vendored DATC corpus as typed cases, and the boards they start from. Shared by the
// engine suite (datc.test.ts) and the order-entry suite (orders/datc-ui.test.ts).
import datc from './datc.json'
import { classicalMap } from '../../maps/classical'
import { boardFromUnits } from '../index'
import type { BoardState, Phase, Season } from '../types'
import type { Unit } from '../../types'
import { toNation } from './datc-codes'
import { parseLoc, parseUnit, splitNation, unitType, type CasePhase } from './datc-parse'

export interface Case {
  name: string
  url: string
  phase: CasePhase
  orders: Record<string, 'Succeeds' | 'Fails' | null>
  starting_state?: string[]
  ignore?: string
  /** Rulebook edition; absent means the default (2000) ruleset this engine implements. */
  edition?: string
  preceding_main_phase?: { orders: Record<string, 'Succeeds' | 'Fails' | null> }
}

export const cases = (datc as unknown as { cases: Case[] }).cases

/** A unit standing at each ordered province (build orders reference an empty center). */
export function inferUnits(orderStrings: string[]): Unit[] {
  const units = new Map<string, Unit>()
  for (const s of orderStrings) {
    const [code, body] = splitNation(s)
    const parts = body.split(/\s+/)
    if (parts[2]?.toLowerCase() === 'build') continue
    const loc = parseLoc(parts[1])
    units.set(loc.province, { type: unitType(parts[0]), nation: toNation(code), territory: loc.province, coast: loc.coast })
  }
  return [...units.values()]
}

/** The case's board (stated or inferred units, home centers seeded) in the given phase. */
export const caseBoard = (
  c: { starting_state?: string[]; orders: Record<string, unknown> },
  season: Season,
  phase: Phase,
): BoardState =>
  boardFromUnits(classicalMap, c.starting_state ? c.starting_state.map(parseUnit) : inferUnits(Object.keys(c.orders)), 1901, season, phase)
