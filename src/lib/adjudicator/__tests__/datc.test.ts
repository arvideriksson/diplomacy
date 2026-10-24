// Data-driven DATC suite. Iterates the vendored TedDriggs corpus, runs each case
// through the engine, and asserts per-order Succeeds/Fails. Results are grouped by
// DATC section (from the case url). See datc.NOTICE.md for corpus provenance.

import { describe, it, expect } from 'vitest'
import datc from './datc.json'
import { classicalMap } from '../../maps/classical'
import { adjudicate, boardFromUnits } from '../index'
import type { BoardState, Phase, Season } from '../types'
import type { Unit } from '../../types'
import { assertCodesCoverMap, toNation } from './datc-codes'
import {
  casePhase,
  orderSource,
  parseLoc,
  parseOrder,
  parseUnit,
  splitNation,
  unitType,
  type CasePhase,
} from './datc-parse'
import { SKIP } from './datc-allowlist'

interface Case {
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

const cases = (datc as unknown as { cases: Case[] }).cases

// ── code-coverage guard: every province token in the corpus maps to a real key ──
const tokenRe = /([FA] |-> |convoys |supports [FA] )([a-z]{3})/g
const allTokens = new Set<string>()
const scan = (s: string) => {
  for (const m of s.matchAll(tokenRe)) allTokens.add(m[2])
}
for (const c of cases) {
  Object.keys(c.orders).forEach(scan)
  c.starting_state?.forEach(scan)
  if (c.preceding_main_phase) Object.keys(c.preceding_main_phase.orders).forEach(scan)
}
assertCodesCoverMap(classicalMap, [...allTokens])

const section = (url: string): string => url.match(/#(6\.[A-J])/)?.[1] ?? 'other'

// infer a unit standing at each ordered/placed province
function inferUnits(orderStrings: string[]): Unit[] {
  const units = new Map<string, Unit>()
  for (const s of orderStrings) {
    const [code, body] = splitNation(s)
    const parts = body.split(/\s+/)
    if (parts[2]?.toLowerCase() === 'build') continue // build orders reference an empty center
    const loc = parseLoc(parts[1])
    units.set(loc.province, { type: unitType(parts[0]), nation: toNation(code), territory: loc.province, coast: loc.coast })
  }
  return [...units.values()]
}

/** The case's board (stated or inferred units, home centers seeded) in the given phase. */
function caseBoard(
  c: { starting_state?: string[]; orders: Record<string, unknown> },
  season: Season,
  phase: Phase,
): BoardState {
  const units = c.starting_state ? c.starting_state.map(parseUnit) : inferUnits(Object.keys(c.orders))
  return boardFromUnits(classicalMap, units, 1901, season, phase)
}

/** Build the board in the case's target phase, running any preceding main phase. */
function boardForCase(c: Case): BoardState {
  const phase = casePhase(c.phase)
  if (c.preceding_main_phase) {
    const season = c.phase === 'Build' ? 'Fall' : 'Spring'
    const pre = caseBoard(c.preceding_main_phase, season, 'movement')
    const orders = Object.keys(c.preceding_main_phase.orders).map((s) => parseOrder('Main', s))
    return adjudicate(classicalMap, pre, orders).newBoardState
  }
  // build / retreat with no preceding context play out in Fall
  return caseBoard(c, phase === 'movement' ? 'Spring' : 'Fall', phase)
}

// ── group cases by section for readable reporting ──────────────────────────────
const bySection = new Map<string, Case[]>()
for (const c of cases) {
  const s = section(c.url)
  const list = bySection.get(s) ?? []
  list.push(c)
  bySection.set(s, list)
}

for (const [sec, group] of [...bySection.entries()].sort()) {
  describe(`DATC ${sec}`, () => {
    for (const c of group) {
      const skipReason =
        c.ignore ??
        SKIP[c.name] ??
        (c.edition ? `edition ${c.edition} (engine implements default/2000 rules)` : undefined)
      const runner = skipReason ? it.skip : it
      runner(`${c.name}${skipReason ? ` — SKIP: ${skipReason}` : ''}`, () => {
        const board = boardForCase(c)
        const orders = Object.keys(c.orders).map((s) => parseOrder(c.phase, s))
        const { results } = adjudicate(classicalMap, board, orders)

        for (const [orderStr, expected] of Object.entries(c.orders)) {
          if (expected === null) continue
          const parsed = parseOrder(c.phase, orderStr)
          const src = orderSource(parsed)
          const result = results.find((r) => orderSource(r.order) === src)
          expect(result, `no result for ${orderStr}`).toBeDefined()
          const succeeded = result!.code === 'succeeds'
          expect(
            succeeded ? 'Succeeds' : 'Fails',
            `${orderStr} => code=${result!.code} (${result!.reason})`,
          ).toBe(expected)
        }
      })
    }
  })
}
