// Data-driven DATC suite. Iterates the vendored TedDriggs corpus, runs each case
// through the engine, and asserts per-order Succeeds/Fails. Results are grouped by
// DATC section (from the case url). See datc.NOTICE.md for corpus provenance.

import { describe, it, expect } from 'vitest'
import datc from './datc.json'
import { classicalMap } from '../../maps/classical'
import { adjudicate, initialBoard } from '../index'
import type { BoardState } from '../types'
import type { Unit } from '../../types'
import {
  assertCodesCoverMap,
  toNation,
  toProvince,
} from './datc-codes'
import { casePhase, orderSource, parseOrder, parseUnit, type CasePhase } from './datc-parse'
import { SKIP } from './datc-allowlist'
import { recomputeSupplyCenters } from '../state'

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
    const [code, body] = [s.slice(0, s.indexOf(':')).trim(), s.slice(s.indexOf(':') + 1).trim()]
    const parts = body.split(/\s+/)
    const verb = parts[2]?.toLowerCase()
    if (verb === 'build') continue // build orders reference an empty center
    const m = parts[1].match(/^([a-z]{3})(?:\(([a-z]{2})\))?$/i)
    if (!m) continue
    const prov = toProvince(m[1])
    units.set(prov, {
      type: parts[0].toUpperCase() === 'F' ? 'fleet' : 'army',
      nation: toNation(code),
      territory: prov,
      coast: m[2]?.toLowerCase(),
    })
  }
  return [...units.values()]
}

function seedSupplyCenters(units: Unit[]): Record<string, string> {
  const owners: Record<string, string> = {}
  for (const [id, t] of Object.entries(classicalMap.territories)) {
    if (t.supplyCenter && t.homePower) owners[id] = t.homePower
  }
  return recomputeSupplyCenters(classicalMap, units, owners)
}

function mainBoard(c: { starting_state?: string[]; orders: Record<string, unknown> }, season: BoardState['season']): BoardState {
  const units = c.starting_state ? c.starting_state.map(parseUnit) : inferUnits(Object.keys(c.orders))
  return {
    mapId: 'classical',
    year: 1901,
    season,
    phase: 'movement',
    units,
    supplyCenters: seedSupplyCenters(units),
    dislodged: [],
    contested: [],
  }
}

/** Build the board in the case's target phase, running any preceding main phase. */
function boardForCase(c: Case): BoardState {
  const phase = casePhase(c.phase)
  if (c.preceding_main_phase) {
    const season = c.phase === 'Build' ? 'Fall' : 'Spring'
    const pre = mainBoard(c.preceding_main_phase, season)
    const orders = Object.keys(c.preceding_main_phase.orders).map((s) => parseOrder('Main', s))
    return adjudicate(classicalMap, pre, orders).newBoardState
  }
  if (phase === 'movement') return mainBoard(c, 'Spring')
  // build / retreat with no preceding context
  const units = c.starting_state ? c.starting_state.map(parseUnit) : inferUnits(Object.keys(c.orders))
  return {
    mapId: 'classical',
    year: 1901,
    season: 'Fall',
    phase,
    units,
    supplyCenters: seedSupplyCenters(units),
    dislodged: [],
    contested: [],
  }
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
