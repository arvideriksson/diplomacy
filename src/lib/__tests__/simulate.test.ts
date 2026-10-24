// Randomized whole-game simulation. Every order is built the way a player builds it
// (through the order wizard and the retreat/build option helpers), then adjudicated.
// Checks, at every phase:
//   - the engine never voids an order the UI offered (UI and engine agree on legality),
//   - board invariants (one unit per province, valid unit types and coasts),
//   - adjustments leave every nation at or under its unit allowance,
//   - adjudication is deterministic,
//   - phases advance in order and victory follows the map's victory rule.
// SIM_GAMES (default 30) and SIM_YEARS (default 25) scale the run.

import { describe, expect, it } from 'vitest'
import { adjudicate, initialBoard } from '../adjudicator'
import type { AnyOrder, BoardState } from '../adjudicator'
import { unitAllowance, isLongRoute } from '../adjudicator/rules'
import type { MapDefinition } from '../mapDefinition'
import { map1900 } from '../maps/1900'
import { classicalMap } from '../maps/classical'
import { finalize, nextStep, type Draft } from '../orders/wizard'
import { convoyReach, reachable } from '../orders/options'
import { replayFrames, type ResolvedOrderRow } from '../history'
import { buildSituation, retreatTargets } from '../orders/adjustments'
import type { Order } from '../orders/types'

const GAMES = Number(process.env.SIM_GAMES ?? 30)
const YEARS = Number(process.env.SIM_YEARS ?? 25)

const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Put an order in the list, replacing any earlier order for the same unit. */
function setOrder(orders: Order[], o: Order) {
  const i = orders.findIndex((x) => x.source === o.source)
  if (i >= 0) orders[i] = o
  else orders.push(o)
}

interface Stats { convoyMoves: number; convoysLanded: number; phases: number; orders: number; voids: string[]; victories: number; longMoves: number; convoyCoastConvoys: number; emergencyBuilds: number; retreats: number; builds: number; removals: number; years: number }

function movementOrders(map: MapDefinition, board: BoardState, r: () => number, stats: Stats): Order[] {
  const orders: Order[] = []
  for (const unit of board.units) {
    if (r() < 0.15) continue // missing order: holds
    const draft: Draft = { source: unit.territory, sourceCoast: unit.coast }
    const ctx = { map, unit, units: board.units }
    for (let guard = 0; guard < 12; guard++) {
      const step = nextStep(draft, ctx)
      if (step.kind === 'done') break
      if (step.kind === 'orderType') {
        // bias toward moves so the board actually evolves
        const types = step.orderTypes
        const pick = r()
        draft.type = types.includes('Move') && pick < 0.55 ? 'Move' : types[Math.floor(r() * types.length)]
        continue
      }
      if (!step.choices.length) { draft.type = 'Hold'; break }
      const c = step.choices[Math.floor(r() * step.choices.length)]
      if (c.chain) draft.convoyPath = [...(draft.convoyPath ?? []), c.id] // as the UI does: extend the convoy route
      else if (step.field === 'target') { draft.target = c.id; if (c.coast) draft.targetCoast = c.coast }
      else if (step.field === 'aux') draft.aux = c.id
      else draft.targetCoast = c.coast ?? c.id
    }
    if (!draft.type) continue
    const o = finalize(draft, ctx)
    if (o.type === 'Move' && isLongRoute(map, o.source, o.target!)) stats.longMoves++
    if (o.type === 'Convoy' && map.territories[o.source].type !== 'sea') stats.convoyCoastConvoys++
    orders.push(o)
  }
  // Coordinated attacks (most turns): each nation picks centers it can reach and
  // sends one unit in with every other able unit supporting — via wizard choices.
  if (r() < 0.8) coordinate(map, board, orders, r)
  // Convoys as a player builds them in the UI: pick fleets one by one (each step only
  // offers fleets that can extend the route), then a landing; own fleets get convoy orders.
  for (const army of board.units.filter((u) => u.type === 'army')) {
    if (r() > 0.25) continue
    const draft: Draft = { source: army.territory, type: 'Move', convoyPath: [] }
    let dest: string | undefined
    for (let guard = 0; guard < 8 && !dest; guard++) {
      const step = nextStep(draft, { map, unit: army, units: board.units })
      if (step.kind !== 'province') break
      const fleets = step.choices.filter((c) => c.chain), lands = step.choices.filter((c) => !c.chain)
      if (draft.convoyPath!.length && lands.length && (r() < 0.6 || !fleets.length)) dest = lands[Math.floor(r() * lands.length)].id
      else if (fleets.length) draft.convoyPath!.push(fleets[Math.floor(r() * fleets.length)].id)
      else break
    }
    if (!dest) continue
    setOrder(orders, { type: 'Move', nation: army.nation, source: army.territory, target: dest, viaConvoy: true })
    stats.convoyMoves++
    for (const f of draft.convoyPath!) {
      const fleet = board.units.find((u) => u.territory === f)!
      if (fleet.nation === army.nation || r() < 0.5) setOrder(orders, { type: 'Convoy', nation: fleet.nation, source: f, aux: army.territory, target: dest })
    }
  }
  return orders
}

function coordinate(map: MapDefinition, board: BoardState, orders: Order[], r: () => number) {
  const byNation = new Map<string, typeof board.units>()
  for (const u of board.units) byNation.set(u.nation, [...(byNation.get(u.nation) ?? []), u])
  const used = new Set<string>()
  for (const [nation, units] of byNation) {
    const targets = new Map<string, { unit: typeof units[number]; choice: { id: string; coast?: string } }[]>()
    for (const unit of units) {
      const step = nextStep({ source: unit.territory, sourceCoast: unit.coast, type: 'Move' }, { map, unit, units: board.units })
      if (step.kind !== 'province') continue
      for (const c of step.choices) {
        const t = map.territories[c.id]
        if (!t.supplyCenter || board.supplyCenters[c.id] === nation) continue
        targets.set(c.id, [...(targets.get(c.id) ?? []), { unit, choice: c }])
      }
    }
    for (const [target, movers] of [...targets].sort(() => r() - 0.5)) {
      const free = movers.filter((m) => !used.has(m.unit.territory))
      if (!free.length) continue
      const lead = free[Math.floor(r() * free.length)]
      used.add(lead.unit.territory)
      setOrder(orders, { type: 'Move', nation, source: lead.unit.territory, target, ...(lead.unit.coast ? { sourceCoast: lead.unit.coast } : {}), ...(lead.choice.coast ? { targetCoast: lead.choice.coast } : {}) })
      for (const helper of units) {
        if (used.has(helper.territory)) continue
        const st = nextStep({ source: helper.territory, sourceCoast: helper.coast, type: 'Support', aux: lead.unit.territory }, { map, unit: helper, units: board.units })
        if (st.kind === 'province' && st.choices.some((c) => c.id === target)) {
          used.add(helper.territory)
          setOrder(orders, { type: 'Support', nation, source: helper.territory, aux: lead.unit.territory, target, ...(helper.coast ? { sourceCoast: helper.coast } : {}) })
        }
      }
    }
  }
}

function retreatOrders(map: MapDefinition, board: BoardState, r: () => number): AnyOrder[] {
  return board.dislodged.map((d) => {
    const targets = retreatTargets(map, d.unit, d.attackedFrom, board.units, board.contested)
    if (!targets.length || r() < 0.2) return { type: 'Disband', nation: d.unit.nation, source: d.unit.territory }
    const t = targets[Math.floor(r() * targets.length)]
    const coast = t.coasts.length ? t.coasts[Math.floor(r() * t.coasts.length)] : undefined
    return { type: 'Retreat', nation: d.unit.nation, source: d.unit.territory, target: t.province, ...(coast ? { targetCoast: coast } : {}) }
  })
}

function buildOrders(map: MapDefinition, board: BoardState, r: () => number, stats: Stats): AnyOrder[] {
  const out: AnyOrder[] = []
  const nations = [...new Set([...Object.values(board.supplyCenters), ...board.units.map((u) => u.nation)])].sort()
  for (const nation of nations) {
    const s = buildSituation(map, nation, board.supplyCenters, board.units)
    if (s.delta > 0) {
      const spots = [...s.spots].sort(() => r() - 0.5).slice(0, s.delta)
      for (const spot of spots) {
        if (r() < 0.1) continue // waive
        const type = spot.types[Math.floor(r() * spot.types.length)]
        const coast = type === 'fleet' && spot.coasts?.length ? spot.coasts[Math.floor(r() * spot.coasts.length)] : undefined
        if (map.rules?.emergency?.buildSite === spot.province) stats.emergencyBuilds++
        out.push({ type: 'Build', nation, source: spot.province, unitType: type, ...(coast ? { sourceCoast: coast } : {}) })
        stats.builds++
      }
    } else if (s.delta < 0 && r() < 0.85) {
      for (const u of [...s.removable].sort(() => r() - 0.5).slice(0, -s.delta)) {
        out.push({ type: 'Remove', nation, source: u.territory }); stats.removals++
      }
    }
  }
  return out
}

function checkBoard(map: MapDefinition, b: BoardState, where: string) {
  const seen = new Set<string>()
  for (const u of b.units) {
    const t = map.territories[u.territory]
    expect(t, `${where}: unit on unknown province ${u.territory}`).toBeTruthy()
    expect(seen.has(u.territory), `${where}: two units in ${u.territory}`).toBe(false)
    seen.add(u.territory)
    if (u.type === 'army') expect(t.type, `${where}: army at sea in ${u.territory}`).not.toBe('sea')
    if (u.type === 'fleet') {
      expect(t.type, `${where}: fleet inland in ${u.territory}`).not.toBe('land')
      if (t.coasts) expect(u.coast && t.coasts[u.coast], `${where}: fleet in ${u.territory} without valid coast (${u.coast})`).toBeTruthy()
      else expect(u.coast, `${where}: fleet in ${u.territory} with stray coast ${u.coast}`).toBeFalsy()
    }
  }
  for (const id of Object.keys(b.supplyCenters)) expect(map.territories[id]?.supplyCenter, `${where}: owner on non-center ${id}`).toBe(true)
}

function playGame(map: MapDefinition, seed: number, stats: Stats, frames?: { board: BoardState; orders: AnyOrder[] }[]) {
  const r = rng(seed)
  let board = initialBoard(map)
  const endYear = board.year + YEARS
  checkBoard(map, board, `seed ${seed} start`)
  while (board.year < endYear) {
    const where = `seed ${seed} ${board.season} ${board.year} ${board.phase}`
    const orders = board.phase === 'movement' ? movementOrders(map, board, r, stats) : board.phase === 'retreat' ? retreatOrders(map, board, r) : buildOrders(map, board, r, stats)
    if (board.phase === 'retreat') stats.retreats += board.dislodged.length
    const res = adjudicate(map, board, orders)
    frames?.push({ board, orders })
    // determinism
    expect(JSON.stringify(adjudicate(map, board, orders)), `${where}: non-deterministic`).toBe(JSON.stringify(res))
    // the UI only offered legal orders
    for (const x of res.results) {
      const offered = orders.includes(x.order)
      const illegal = x.code === 'void' || x.reason === 'illegal retreat target'
      if (offered && illegal) stats.voids.push(`${where}: ${JSON.stringify(x.order)} -> ${x.reason}`)
    }
    stats.orders += orders.length
    if (board.phase === 'movement') for (const x of res.results) {
      const o = x.order as Order
      if (o.type === 'Move' && x.code === 'succeeds' && board.units.find((u) => u.territory === o.source)?.type === 'army' && !map.territories[o.source].adjacent.includes(o.target!)) stats.convoysLanded++
    }
    stats.phases++
    const next = res.newBoardState
    checkBoard(map, next, where)
    // Independent movement checks (not using the engine's own logic).
    if (board.phase === 'movement') {
      const moved = new Map<string, string>()
      for (const x of res.results) {
        const o = x.order as Order
        if (o.type !== 'Move' || x.code !== 'succeeds') continue
        const u = board.units.find((v) => v.territory === o.source)!
        moved.set(o.source, o.target!)
        if (reachable(map, u).includes(o.target!)) continue
        // otherwise: an army carried by fleets ordered to convoy it, forming a chain
        expect(u.type, `${where}: fleet jumped ${o.source}->${o.target}`).toBe('army')
        if (map.territories[o.source].adjacent.includes(o.target!) && !o.viaConvoy) continue
        const fleets = new Set(orders.filter((c) => c.type === 'Convoy' && c.aux === o.source && c.target === o.target).map((c) => c.source))
        expect(convoyReach(map, o.source, board.units.filter((v) => fleets.has(v.territory))), `${where}: ${o.source}->${o.target} without a convoy chain`).toContain(o.target)
      }
      for (const d of next.dislodged) expect([...moved.values()], `${where}: ${d.unit.territory} dislodged without a successful attack`).toContain(d.unit.territory)
      if (next.phase === 'retreat') expect(next.supplyCenters, `${where}: centers changed hands before retreats`).toEqual(board.supplyCenters)
    }
    if (board.season === 'Spring') expect(next.supplyCenters, `${where}: centers changed in Spring`).toEqual(board.supplyCenters)
    // phase progression
    if (board.phase === 'build') expect([next.year, next.season, next.phase]).toEqual([board.year + 1, 'Spring', 'movement'])
    if (next.phase === 'retreat') expect(next.dislodged.length).toBeGreaterThan(0)
    if (board.phase === 'build') {
      for (const n of new Set(next.units.map((u) => u.nation))) {
        expect(next.units.filter((u) => u.nation === n).length, `${where}: ${n} over allowance`).toBeLessThanOrEqual(unitAllowance(map, n, next.supplyCenters))
      }
    }
    if (res.victory) {
      stats.victories++
      const counts: Record<string, number> = {}
      for (const n of Object.values(next.supplyCenters)) counts[n] = (counts[n] ?? 0) + 1
      expect(res.victory.centers).toBe(counts[res.victory.nation])
      if (map.rules?.strictVictory) for (const [n, c] of Object.entries(counts)) if (n !== res.victory.nation) expect(c).toBeLessThan(res.victory.centers)
      board = next
      break
    }
    board = next
  }
  frames?.push({ board, orders: [] })
  stats.years += board.year - initialBoard(map).year
}

for (const map of [map1900, classicalMap]) {
  describe(`simulated ${map.name} games`, () => {
    it(`plays ${GAMES} random games without illegal UI orders or broken invariants`, () => {
      const stats: Stats = { convoyMoves: 0, convoysLanded: 0, phases: 0, orders: 0, voids: [], victories: 0, longMoves: 0, convoyCoastConvoys: 0, emergencyBuilds: 0, retreats: 0, builds: 0, removals: 0, years: 0 }
      for (let g = 0; g < GAMES; g++) playGame(map, 1000 + g, stats)
      const { voids, ...summary } = stats
      console.log(`${map.name}:`, JSON.stringify({ ...summary, voidCount: voids.length }), voids.slice(0, 8).join('\n'))
      expect(voids).toEqual([])
    }, 600_000)
  })
}

// SIM_DUMP=<file>: write a few full games as sandboxes for UI screenshots.
if (process.env.SIM_DUMP) {
  it('dumps sandboxes', async () => {
    const { writeFileSync } = await import('node:fs')
    const out = []
    for (const [map, seed] of [[map1900, 1003], [map1900, 1007], [map1900, 1011], [classicalMap, 1002]] as const) {
      const frames: { board: BoardState; orders: AnyOrder[] }[] = []
      playGame(map, seed, { convoyMoves: 0, convoysLanded: 0, phases: 0, orders: 0, voids: [], victories: 0, longMoves: 0, convoyCoastConvoys: 0, emergencyBuilds: 0, retreats: 0, builds: 0, removals: 0, years: 0 }, frames)
      out.push({ id: `sim-${map.id}-${seed}`, name: `Sim ${map.name} #${seed}`, mapId: map.id, frames, cursor: 0, createdAt: new Date(0).toISOString() })
    }
    writeFileSync(process.env.SIM_DUMP!, JSON.stringify(out))
  })
}

describe('history replay', () => {
  it('replaying the resolved order log reproduces every simulated board', () => {
    for (const map of [map1900, classicalMap]) for (let seed = Number(process.env.REPLAY_SEED ?? 2000); seed < Number(process.env.REPLAY_SEED ?? 2000) + (process.env.REPLAY_SEED ? 1 : 10); seed++) {
      const frames: { board: BoardState; orders: AnyOrder[] }[] = []
      playGame(map, seed, { convoyMoves: 0, convoysLanded: 0, phases: 0, orders: 0, voids: [], victories: 0, longMoves: 0, convoyCoastConvoys: 0, emergencyBuilds: 0, retreats: 0, builds: 0, removals: 0, years: 0 }, frames)
      // The log stores one row per nation per round, as the orders table does.
      const rows: ResolvedOrderRow[] = frames.slice(0, -1).flatMap(({ board, orders }) => {
        const byNation = new Map<string, AnyOrder[]>()
        for (const o of orders) byNation.set(o.nation, [...(byNation.get(o.nation) ?? []), o])
        return [...byNation].map(([nation, os]) => ({ year: board.year, season: board.season, phase: board.phase, nation, orders: os }))
      })
      const last = frames.at(-1)!.board
      const replayed = replayFrames(map, rows, { year: last.year, season: last.season, phase: last.phase })
      if (process.env.REPLAY_DEBUG) {
        const keys = new Set(rows.map((r) => `${r.year}|${r.season}|${r.phase}`))
        const missing = frames.slice(0, -1).filter((f) => !keys.has(`${f.board.year}|${f.board.season}|${f.board.phase}`)).map((f) => `${f.board.season} ${f.board.year} ${f.board.phase} (${f.orders.length} orders)`)
        console.log(map.id, seed, 'frames', frames.length, 'replayed', replayed.length, 'rounds without rows:', missing.slice(0, 6).join('; '))
        const k = frames.findIndex((f, i) => JSON.stringify(f.board) !== JSON.stringify(replayed[i]?.board))
        if (k >= 0) {
          const A = frames[k].board, B = replayed[k].board
          console.log('first diff at', k, A.season, A.year, A.phase, 'vs', B.season, B.year, B.phase, 'prev orders', JSON.stringify(frames[k - 1].orders).slice(0, 300))
          console.log('prev replay orders', JSON.stringify(replayed[k - 1].orders).slice(0, 300))
        }
      }
      // Every phase, including rounds where nobody ordered anything (no rows), replays identically.
      expect(replayed.length, `${map.id} seed ${seed}`).toBe(frames.length)
      frames.forEach((f, i) => expect(JSON.stringify(replayed[i].board), `${map.id} seed ${seed} frame ${i}`).toBe(JSON.stringify(f.board)))
    }
  })
})
