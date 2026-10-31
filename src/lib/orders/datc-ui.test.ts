// Can every DATC order be entered through the order UI? Drives the same pure entry
// functions GameBoard uses (wizard steps + applyChoice clicks, retreat choices, build
// spots) over each case's board, and reports orders the UI cannot produce.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import datc from '../adjudicator/__tests__/datc.json'
import { classicalMap } from '../maps/classical'
import { adjudicate, boardFromUnits } from '../adjudicator/index'
import type { BoardState, Phase, Season } from '../adjudicator/types'
import type { Unit } from '../types'
import { casePhase, parseLoc, parseOrder, parseUnit, splitNation, unitType, type CasePhase } from '../adjudicator/__tests__/datc-parse'
import { toNation } from '../adjudicator/__tests__/datc-codes'
import { nextStep, finalize, applicableOrderTypes, type Draft } from './wizard'
import { applyChoice, retreatChoices, openBuildSpots, openRemovals, type NationSituation } from './board'
import { buildSituation } from './adjustments'
import { toDsvgId } from '../map/idMap'
import type { AnyOrder, BuildOrder, Order, OrderType, RetreatOrder } from './types'

interface Case {
  name: string
  url: string
  phase: CasePhase
  orders: Record<string, 'Succeeds' | 'Fails' | null>
  starting_state?: string[]
  ignore?: string
  edition?: string
  preceding_main_phase?: { orders: Record<string, 'Succeeds' | 'Fails' | null> }
}
const cases = (datc as unknown as { cases: Case[] }).cases
const map = classicalMap

function inferUnits(orderStrings: string[]): Unit[] {
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
const caseBoard = (c: { starting_state?: string[]; orders: Record<string, unknown> }, season: Season, phase: Phase): BoardState =>
  boardFromUnits(map, c.starting_state ? c.starting_state.map(parseUnit) : inferUnits(Object.keys(c.orders)), 1901, season, phase)

/** Every movement order the wizard can produce for `unit` (with the convoy route picked). */
type Click = { province: string } | { action: string }
function enterable(unit: Unit, units: Unit[]): Array<{ order: Order; path?: string[]; clicks: Click[] }> {
  const ctx = { map, unit, units }
  const out: Array<{ order: Order; path?: string[]; clicks: Click[] }> = []
  const types: OrderType[] = applicableOrderTypes(ctx)
  const walk = (d: Draft, depth: number, clicks: Click[]) => {
    const step = nextStep(d, ctx)
    if (step.kind === 'done') return void out.push({ order: finalize(d, ctx), path: d.convoyPath, clicks })
    if (step.kind !== 'province' || depth > 12) return
    const seen = new Set<string>()
    for (const c of step.choices) {
      const id = toDsvgId(c.id, c.coast)
      if (seen.has(id)) continue // a click picks the first choice with that id
      seen.add(id)
      const next = applyChoice(d, step, id)
      if (next) walk(next, depth + 1, [...clicks, { province: id }])
    }
  }
  // Selecting a unit is already a Move; other order types are picked on the action bar.
  const pick = { province: toDsvgId(unit.territory) }
  for (const type of types) walk({ source: unit.territory, sourceCoast: unit.coast, type }, 0, type === 'Move' ? [pick] : [pick, { action: type }])
  return out
}

const same = (a?: string, b?: string) => (a ?? '') === (b ?? '')

let lastHit: Order | undefined
let lastClicks: Click[] = []
function matchMovement(want: Order, units: Unit[]): string | null {
  lastHit = undefined
  const unit = units.find((u) => u.territory === want.source)
  if (!unit) return 'no unit there'
  if (unit.nation !== want.nation) return `unit belongs to ${unit.nation}`
  const all = enterable(unit, units)
  const ofType = all.filter((e) => e.order.type === want.type)
  if (!ofType.length) return `${want.type} not offered (types: ${[...new Set(all.map((e) => e.order.type))].join(',')})`
  // Prefer the UI form whose via-convoy flag matches the order's.
  const byVia = [...ofType].sort((a, b) => Number(!!b.order.viaConvoy === !!want.viaConvoy) - Number(!!a.order.viaConvoy === !!want.viaConvoy))
  const hit = byVia.find((e) => {
    const o = e.order
    if (want.type === 'Hold') return true
    if (want.type === 'Move')
      return same(o.target, want.target) && (unit.type === 'army' || same(o.targetCoast, want.targetCoast))
    if (want.type === 'Support') return same(o.aux, want.aux) && same(o.target ?? o.aux, want.target ?? want.aux)
    return same(o.aux, want.aux) && same(o.target, want.target)
  })
  if (!hit) {
    if (want.type === 'Move') {
      const t = ofType.filter((e) => e.order.target === want.target)
      if (t.length) return `target offered only with coast ${t.map((e) => e.order.targetCoast).join('/')}`
      return `target not offered (offered: ${[...new Set(ofType.map((e) => e.order.target + (e.order.targetCoast ? `(${e.order.targetCoast})` : '')))].join(' ')})`
    }
    const auxes = ofType.filter((e) => e.order.aux === want.aux)
    if (!auxes.length) return `aux ${want.aux} not offered`
    return `target not offered for aux (offered: ${[...new Set(auxes.map((e) => e.order.target))].join(' ')})`
  }
  lastHit = hit.order
  lastClicks = hit.clicks
  if (want.type === 'Move') {
    const viaUi = Boolean(hit.order.viaConvoy)
    const direct = ofType.some((e) => same(e.order.target, want.target) && !e.order.viaConvoy && (unit.type === 'army' || same(e.order.targetCoast, want.targetCoast)))
    if (want.viaConvoy && !ofType.some((e) => e.order.target === want.target && e.order.viaConvoy)) return 'NOTE: via-convoy form not offered'
    if (!want.viaConvoy && !direct && viaUi) return 'NOTE: only enterable via convoy (UI marks viaConvoy)'
  }
  return null
}

it('every DATC order is enterable through the UI', () => {
  const lines: string[] = []
  const scripts: Array<{ name: string; board: BoardState; steps: Array<{ order: string; clicks: Click[]; expect: AnyOrder }> }> = []
  let total = 0
  let bad = 0
  for (const c of cases) {
    const phases: Array<{ phase: CasePhase; board: BoardState; orders: string[]; expect: Record<string, unknown> }> = []
    let board: BoardState
    if (c.preceding_main_phase) {
      const season = c.phase === 'Build' ? 'Fall' : 'Spring'
      const pre = caseBoard(c.preceding_main_phase, season, 'movement')
      const preOrders = Object.keys(c.preceding_main_phase.orders)
      phases.push({ phase: 'Main', board: pre, orders: preOrders, expect: c.preceding_main_phase.orders })
      board = adjudicate(map, pre, preOrders.map((s) => parseOrder('Main', s))).newBoardState
    } else {
      const p = casePhase(c.phase)
      board = caseBoard(c, p === 'movement' ? 'Spring' : 'Fall', p)
    }
    phases.push({ phase: c.phase, board, orders: Object.keys(c.orders), expect: c.orders })

    for (const ph of phases) {
      const results = adjudicate(map, ph.board, ph.orders.map((s) => parseOrder(ph.phase, s))).results
      const entered: AnyOrder[] = []
      const uiOrders: AnyOrder[] = []
      const steps: Array<{ order: string; clicks: Click[]; expect: AnyOrder }> = []
      scripts.push({ name: c.name + (ph.phase === c.phase ? '' : ' [pre]'), board: ph.board, steps })
      for (const s of ph.orders) {
        total++
        const want = parseOrder(ph.phase, s)
        const unitLetter = splitNation(s)[1].split(/\s+/)[0]
        let why: string | null = null
        const u = ph.board.units.find((x) => x.territory === (want as { source: string }).source)
        if (ph.phase === 'Main') {
          if (u && u.type !== unitType(unitLetter)) why = `order names ${unitType(unitLetter)} but unit is ${u.type}`
          else why = matchMovement(want as Order, ph.board.units)
          if (lastHit) {
            uiOrders.push(lastHit)
            steps.push({ order: s, clicks: lastClicks, expect: lastHit })
          }
        } else if (ph.phase === 'Retreat') {
          const r = want as RetreatOrder
          const d = ph.board.dislodged.find((x) => x.unit.territory === r.source)
          if (!d) why = 'no dislodged unit there'
          else if (r.type === 'Retreat') {
            const ch = retreatChoices(map, d, ph.board.units, ph.board.contested)
            if (!ch.some((x) => x.province === r.target && (d.unit.type === 'army' || same(x.coast, r.targetCoast))))
              why = `retreat target not offered (offered: ${ch.map((x) => x.province + (x.coast ? `(${x.coast})` : '')).join(' ') || 'none'})`
          }
        } else {
          const b = want as BuildOrder
          const sits: NationSituation[] = [...new Set([...ph.board.units.map((x) => x.nation), ...Object.values(ph.board.supplyCenters)])].map((n) => ({
            nation: n,
            ...buildSituation(map, n, ph.board.supplyCenters, ph.board.units),
          }))
          if (b.type === 'Build') {
            const spot = openBuildSpots(sits, entered).find((sp) => sp.province === b.source && sp.nation === b.nation)
            if (!spot) why = 'build spot not offered'
            else if (!spot.types.includes(b.unitType!)) why = `unit type ${b.unitType} not offered`
            else if (b.unitType === 'fleet' && (spot.coasts?.length ?? 0) > 1 && !spot.coasts!.includes(b.sourceCoast ?? '')) why = `fleet coast required (${spot.coasts})`
          } else if (!openRemovals(sits, entered).some((r) => r.territory === b.source && r.nation === b.nation)) why = 'removal not offered'
          if (!why) entered.push(b)
        }
        if (ph.phase !== 'Main' && !why) {
          uiOrders.push(want)
          const at = toDsvgId((want as { source: string }).source)
          const r = want as Omit<RetreatOrder, 'type'> & Omit<BuildOrder, 'type'> & { type: string }
          const clicks: Click[] =
            r.type === 'Retreat' ? [{ province: at }, { province: toDsvgId(r.target!, u?.type === 'fleet' ? r.targetCoast : undefined) }]
            : r.type === 'Disband' ? [{ province: at }, { action: 'Disband' }]
            : r.type === 'Remove' ? [{ province: at }, { action: 'Remove' }]
            : [{ province: at }, { action: r.unitType === 'army' ? 'Army' : r.sourceCoast ? `Fleet ${map.territories[r.source].coasts![r.sourceCoast].name.replace(/ Coast$/, '')}` : 'Fleet' }]
          steps.push({ order: s, clicks, expect: want })
        }
        if (why) {
          if (!why.startsWith('NOTE')) bad++
          const res = results.find((r) => (r.order as { source: string }).source === (want as { source: string }).source)
          lines.push(`${c.name}\t${ph.phase === c.phase ? '' : '[pre] '}${s}\t${ph.expect[s] ?? 'null'}\t${res?.code ?? '-'}\t${why}`)
        }
      }
      // Re-adjudicate with only the orders as the UI would build them (the rest hold).
      if (ph.phase === c.phase && !c.ignore && !c.edition) {
        const uiResults = adjudicate(map, ph.board, uiOrders).results
        for (const s of ph.orders) {
          const exp = ph.expect[s]
          const src = (parseOrder(ph.phase, s) as { source: string }).source
          const r = uiResults.find((x) => (x.order as { source: string }).source === src)
          const ui = uiOrders.find((o) => (o as { source: string }).source === src)
          if (!ui || exp == null || !r) continue
          const got = r.code === 'succeeds' ? 'Succeeds' : 'Fails'
          if (got !== exp) lines.push(`${c.name}\tUI-ADJ ${s}\t${exp}\t${r.code}\tUI-entered set adjudicates differently`)
        }
      }
    }
  }
  if (process.env.DATC_UI_SCRIPTS) writeFileSync(process.env.DATC_UI_SCRIPTS, JSON.stringify(scripts))
  if (process.env.DATC_UI_OUT) writeFileSync(process.env.DATC_UI_OUT, `total ${total}, not enterable ${bad}\n` + lines.join('\n') + '\n')
})
