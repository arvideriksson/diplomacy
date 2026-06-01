// Movement-phase resolver — Kruijswijk's "Math of Adjudication": dependency
// resolution with two-pass guessing for cycles, and a Szykman backup rule for
// convoy paradoxes. Strengths are province-level and deterministic (orders are
// indexed and iterated in a fixed, province-sorted order).

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { Order } from '../orders/types'
import type { BoardState, DislodgedUnit, OrderResult, ResultCode } from './types'
import { sortIds, sortUnits, unitAt } from './state'
import { canMoveDirect, convoyPathExists, landingCoasts } from './graph'

type Kind = 'hold' | 'move' | 'support' | 'convoy'

interface MOrder {
  idx: number
  kind: Kind
  order: Order
  unit: Unit
  src: string
  /** Move destination, or supported/convoyed destination. */
  dst?: string
  dstCoast?: string
  /** Province of the unit being supported/convoyed. */
  aux?: string
  void: boolean
  reason: string
}

type Res = 'unresolved' | 'guessing' | 'resolved'

export interface MovementOutcome {
  units: Unit[]
  dislodged: DislodgedUnit[]
  contested: string[]
  results: OrderResult[]
}

/**
 * Resolve a movement phase. `orders` are the movement orders submitted; any unit
 * without a matching order is treated as holding.
 */
export function resolveMovement(
  map: MapDefinition,
  board: BoardState,
  orders: Order[],
): MovementOutcome {
  const units = board.units
  // ── Build the internal order list: one entry per unit on the board ─────────
  const mo: MOrder[] = []
  const byProvince = new Map<string, MOrder>()

  // index submitted orders by their source unit's province
  const submitted = new Map<string, Order>()
  for (const o of orders) submitted.set(o.source, o)

  // convoy intents: which army moves have convoying fleets ordered (regardless of
  // whether the path survives). Distinguishes an illegal move from a disrupted one.
  const convoyIntents = new Set<string>()
  for (const o of orders) {
    if (o.type === 'Convoy' && o.aux && o.target) convoyIntents.add(`${o.aux}->${o.target}`)
  }

  for (const unit of sortUnits(units)) {
    const o = submitted.get(unit.territory)
    const entry = normalize(map, unit, o, units, convoyIntents)
    mo.push(entry)
    byProvince.set(unit.territory, entry)
  }
  mo.forEach((m, i) => (m.idx = i))

  const N = mo.length
  const state: Res[] = new Array(N).fill('unresolved')
  const resolution: boolean[] = new Array(N).fill(false)
  const deps: number[] = []

  // ── Strength helpers ───────────────────────────────────────────────────────

  const moveOrdersInto = (province: string): MOrder[] =>
    mo.filter((m) => m.kind === 'move' && !m.void && m.dst === province)

  const matchingSupports = (m: MOrder): MOrder[] =>
    mo.filter(
      (s) => s.kind === 'support' && !s.void && s.aux === m.src && s.dst === m.dst,
    )

  const matchingConvoys = (m: MOrder): MOrder[] =>
    mo.filter((c) => c.kind === 'convoy' && !c.void && c.aux === m.src && c.dst === m.dst)

  const hasPath = (m: MOrder): boolean => {
    if (m.unit.type === 'fleet') return true // legality checked in normalize
    // army: direct adjacency or convoy
    if (canMoveDirect(map, m.unit, m.dst!)) return true
    const fleets = new Set(matchingConvoys(m).filter((c) => resolve(c.idx)).map((c) => c.src))
    return convoyPathExists(map, m.src, m.dst!, fleets)
  }

  const isConvoyedMove = (m: MOrder): boolean => {
    if (m.unit.type !== 'army' || m.void) return false
    const convoys = matchingConvoys(m)
    if (convoys.length === 0) return false
    const fleets = new Set(convoys.filter((c) => resolve(c.idx)).map((c) => c.src))
    return convoyPathExists(map, m.src, m.dst!, fleets)
  }

  const headToHeadOpponent = (m: MOrder): MOrder | undefined => {
    if (m.kind !== 'move' || m.void) return undefined
    const o = byProvince.get(m.dst!)
    if (!o || o.kind !== 'move' || o.void) return undefined
    if (o.dst !== m.src) return undefined
    if (isConvoyedMove(m) || isConvoyedMove(o)) return undefined
    return o
  }

  // a support is cut?
  const supportCut = (s: MOrder): boolean => {
    // dislodged supporter -> cut
    if (moveOrdersInto(s.src).some((m) => resolve(m.idx))) return true
    // attacked from a province other than the supported destination, by another power
    for (const m of moveOrdersInto(s.src)) {
      if (m.src === s.dst) continue // attack from the province support is directed at
      if (m.unit.nation === s.unit.nation) continue // can't cut own support
      if (hasPath(m)) return true
    }
    return false
  }

  const supportCount = (m: MOrder, excludeNation?: string): number =>
    matchingSupports(m).filter(
      (s) => !resolveSupportCut(s) && (!excludeNation || s.unit.nation !== excludeNation),
    ).length

  // resolve(support) === support is given (not cut)
  const resolveSupportCut = (s: MOrder): boolean => !resolve(s.idx)

  const holdStrength = (province: string): number => {
    const occ = byProvince.get(province)
    if (!occ) return 0
    if (occ.kind === 'move' && !occ.void) return resolve(occ.idx) ? 0 : 1
    // holding/support/convoy unit: 1 + uncut support-holds
    const supports = mo.filter(
      (s) => s.kind === 'support' && !s.void && s.aux === province && s.dst === province,
    )
    return 1 + supports.filter((s) => !resolveSupportCut(s)).length
  }

  const attackStrength = (m: MOrder): number => {
    if (!hasPath(m)) return 0
    const occ = byProvince.get(m.dst!)
    let vacated = !occ
    if (occ && occ.kind === 'move' && !occ.void) {
      const h2h = headToHeadOpponent(m)
      if (!(h2h && h2h.idx === occ.idx)) vacated = resolve(occ.idx)
    }
    if (vacated) return 1 + supportCount(m)
    // occupant stays
    if (occ!.unit.nation === m.unit.nation) return 0 // can't dislodge own unit
    return 1 + supportCount(m, occ!.unit.nation)
  }

  const defendStrength = (m: MOrder): number => 1 + supportCount(m)

  const preventStrength = (m: MOrder): number => {
    if (!hasPath(m)) return 0
    const h2h = headToHeadOpponent(m)
    if (h2h && resolve(h2h.idx)) return 0 // dislodged by head-to-head opponent
    return 1 + supportCount(m)
  }

  const moveSucceeds = (m: MOrder): boolean => {
    if (!hasPath(m)) return false
    const atk = attackStrength(m)
    if (atk <= 0) return false
    // beat every competing move into the destination
    for (const other of moveOrdersInto(m.dst!)) {
      if (other.idx === m.idx) continue
      if (atk <= preventStrength(other)) return false
    }
    const h2h = headToHeadOpponent(m)
    if (h2h) return atk > defendStrength(h2h)
    return atk > holdStrength(m.dst!)
  }

  const convoyDisrupted = (c: MOrder): boolean =>
    moveOrdersInto(c.src).some((m) => resolve(m.idx))

  // ── adjudicate one order ─────────────────────────────────────────────────
  const adjudicate = (idx: number): boolean => {
    const o = mo[idx]
    if (o.void) return false
    switch (o.kind) {
      case 'hold':
        return true
      case 'move':
        return moveSucceeds(o)
      case 'support':
        return !supportCut(o)
      case 'convoy':
        return !convoyDisrupted(o)
    }
  }

  // ── the guessing resolver ────────────────────────────────────────────────
  function resolve(idx: number): boolean {
    if (state[idx] === 'resolved') return resolution[idx]
    if (state[idx] === 'guessing') {
      if (!deps.includes(idx)) deps.push(idx)
      return resolution[idx]
    }
    const oldDeps = deps.length
    resolution[idx] = false
    state[idx] = 'guessing'
    const first = adjudicate(idx)

    if (deps.length === oldDeps) {
      // adjudicate() may have resolved this order itself (via the backup rule)
      if ((state[idx] as Res) !== 'resolved') {
        resolution[idx] = first
        state[idx] = 'resolved'
      }
      return resolution[idx]
    }
    if (deps[oldDeps] !== idx) {
      // part of a cycle but not its entry point — defer with the guess
      if (!deps.includes(idx)) deps.push(idx)
      resolution[idx] = first
      return first
    }
    // idx is the entry of the cycle: try the opposite guess
    for (let i = oldDeps; i < deps.length; i++) state[deps[i]] = 'unresolved'
    resolution[idx] = true
    state[idx] = 'guessing'
    const second = adjudicate(idx)
    if (first === second) {
      for (let i = oldDeps; i < deps.length; i++) state[deps[i]] = 'unresolved'
      deps.length = oldDeps
      resolution[idx] = first
      state[idx] = 'resolved'
      return first
    }
    // genuine cycle — apply the backup rule, then re-resolve
    backupRule(deps.slice(oldDeps))
    for (let i = oldDeps; i < deps.length; i++)
      if (state[deps[i]] !== 'resolved') state[deps[i]] = 'unresolved'
    deps.length = oldDeps
    return resolve(idx)
  }

  function backupRule(cycle: number[]): void {
    const orders = sortIds(cycle.map(String)).map((s) => mo[Number(s)])
    // A genuine convoy paradox has a convoy ORDER inside the dependency cycle.
    // Circular movement that merely includes a convoyed move does not.
    const convoysInCycle = orders.filter((o) => o.kind === 'convoy')
    if (convoysInCycle.length) {
      // Szykman backup: the paradoxical convoy is treated as disrupted — the
      // convoy fails and its army stays put, so it neither cuts support nor
      // dislodges. The rest of the board then resolves normally.
      for (const c of convoysInCycle) {
        resolution[c.idx] = false
        state[c.idx] = 'resolved'
        const carried = mo.find(
          (m) => m.kind === 'move' && !m.void && m.src === c.aux && m.dst === c.dst,
        )
        if (carried) {
          resolution[carried.idx] = false
          state[carried.idx] = 'resolved'
        }
      }
    } else {
      // pure circular movement: every move in the cycle succeeds.
      for (const o of orders) {
        if (o.kind === 'move') {
          resolution[o.idx] = true
          state[o.idx] = 'resolved'
        }
      }
    }
  }

  // ── resolve everything (canonical order) ───────────────────────────────────
  for (let i = 0; i < N; i++) resolve(i)

  // ── assemble the new board ─────────────────────────────────────────────────
  const results: OrderResult[] = []
  const moved = new Set<string>() // provinces vacated by a successful move
  const nextUnits: Unit[] = []
  const dislodged: DislodgedUnit[] = []

  for (const m of mo) {
    if (m.kind === 'move' && !m.void && resolution[m.idx]) moved.add(m.src)
  }

  // Place units: successful movers go to destination; everyone else stays unless dislodged.
  for (const m of mo) {
    const occupantStays = !(m.kind === 'move' && !m.void && resolution[m.idx])
    if (!occupantStays) {
      // unit moves away
      const dest = m.dst!
      const coast = m.unit.type === 'fleet' ? m.dstCoast : undefined
      nextUnits.push({ ...m.unit, territory: dest, coast })
      continue
    }
    // unit stays here — is it dislodged?
    const attackers = moveOrdersInto(m.src).filter((a) => resolution[a.idx])
    if (attackers.length > 0) {
      // a unit dislodged by a convoyed army may retreat to the army's origin
      const from = isConvoyedMove(attackers[0]) ? '' : attackers[0].src
      dislodged.push({ unit: { ...m.unit }, attackedFrom: from })
    } else {
      nextUnits.push({ ...m.unit })
    }
  }

  // contested (standoff) provinces: empty after resolution, with >=2 failed attackers.
  const contested: string[] = []
  const destinations = sortIds([...new Set(mo.filter((m) => m.kind === 'move' && !m.void).map((m) => m.dst!))])
  for (const d of destinations) {
    const into = moveOrdersInto(d)
    const anySucceeded = into.some((m) => resolution[m.idx])
    const occupiedAfter = nextUnits.some((u) => u.territory === d)
    if (!anySucceeded && !occupiedAfter && into.filter((m) => hasPath(m)).length >= 2) {
      contested.push(d)
    }
  }

  // ── per-order results ──────────────────────────────────────────────────────
  for (const m of mo) {
    let code: ResultCode
    let reason: string
    if (m.void) {
      code = 'void'
      reason = m.reason
    } else if (m.kind === 'move') {
      if (resolution[m.idx]) {
        code = 'succeeds'
        reason = 'move succeeds'
      } else {
        code = 'fails'
        reason = 'move bounced or unsupported'
      }
    } else if (m.kind === 'support') {
      code = resolution[m.idx] ? 'succeeds' : 'fails'
      reason = resolution[m.idx] ? 'support given' : 'support cut'
    } else if (m.kind === 'convoy') {
      code = resolution[m.idx] ? 'succeeds' : 'fails'
      reason = resolution[m.idx] ? 'convoy holds' : 'convoying fleet dislodged'
    } else {
      // hold — report dislodged if it was pushed out
      const wasDislodged = dislodged.some((d) => d.unit.territory === m.src)
      code = wasDislodged ? 'dislodged' : 'succeeds'
      reason = wasDislodged ? 'unit dislodged' : 'unit holds'
    }
    // upgrade a staying move/support/convoy unit that got dislodged
    if (code !== 'void' && dislodged.some((d) => d.unit.territory === m.src) && !(m.kind === 'move' && resolution[m.idx])) {
      code = 'dislodged'
      reason = 'unit dislodged'
    }
    results.push({ order: m.order, code, reason })
  }

  return {
    units: sortUnits(nextUnits),
    dislodged: dislodged.sort((a, b) => (a.unit.territory < b.unit.territory ? -1 : 1)),
    contested: sortIds(contested),
    results: results.sort((a, b) => (orderSrc(a) < orderSrc(b) ? -1 : 1)),
  }
}

const orderSrc = (r: OrderResult): string => (r.order as { source: string }).source

/** Normalize a unit + its (possibly missing) order into an internal order, marking voids. */
function normalize(
  map: MapDefinition,
  unit: Unit,
  o: Order | undefined,
  units: Unit[],
  convoyIntents: Set<string>,
): MOrder {
  const base = (kind: Kind, extra: Partial<MOrder> = {}): MOrder => ({
    idx: -1,
    kind,
    order: o ?? { type: 'Hold', nation: unit.nation, source: unit.territory },
    unit,
    src: unit.territory,
    void: false,
    reason: '',
    ...extra,
  })

  if (o && o.nation !== unit.nation) {
    return voidify(base('hold'), "ordering another power's unit")
  }

  if (!o || o.type === 'Hold') return base('hold')

  if (o.type === 'Move') {
    const m = base('move', { dst: o.target, dstCoast: o.targetCoast })
    if (!o.target) return voidify(m, 'move without destination')
    if (o.sourceCoast && o.sourceCoast !== unit.coast) {
      return voidify(m, 'order specifies the wrong source coast')
    }
    if (unit.type === 'army' && o.targetCoast) {
      return voidify(m, 'army cannot be ordered to a coast')
    }
    if (unit.type === 'army' && !canMoveDirect(map, unit, o.target)) {
      // non-adjacent army move: legal only if it can be convoyed AND fleets were ordered
      const destT = map.territories[o.target]
      const srcT = map.territories[unit.territory]
      const coastalPair = destT?.type === 'coast' && srcT?.type === 'coast'
      if (!coastalPair || !convoyIntents.has(`${unit.territory}->${o.target}`)) {
        return voidify(m, 'illegal move (non-adjacent, no convoy ordered)')
      }
      return m // convoyable — path resolved during adjudication
    }
    if (!validMoveLegality(map, unit, o.target, o.targetCoast)) {
      return voidify(m, 'illegal move (non-adjacent / coast)')
    }
    return m
  }

  if (o.type === 'Support') {
    const s = base('support', { aux: o.aux, dst: o.target ?? o.aux })
    if (!o.aux) return voidify(s, 'support without target')
    // supporter must be able to reach the supported destination province
    if (!canMoveDirect(map, unit, s.dst!) && s.dst !== unit.territory) {
      return voidify(s, 'support of unreachable province')
    }
    return s
  }

  if (o.type === 'Convoy') {
    const c = base('convoy', { aux: o.aux, dst: o.target })
    if (unit.type !== 'fleet' || map.territories[unit.territory]?.type !== 'sea') {
      return voidify(c, 'only a fleet at sea may convoy')
    }
    if (!o.aux || !o.target) return voidify(c, 'convoy without army/destination')
    const army = unitAt(units, o.aux)
    if (!army || army.type !== 'army') return voidify(c, 'convoyed unit is not an army')
    return c
  }

  return base('hold')
}

function voidify(m: MOrder, reason: string): MOrder {
  m.void = true
  m.reason = reason
  return m
}

/** Move legality ignoring occupancy: adjacency (or convoy possible) + coast validity. */
function validMoveLegality(
  map: MapDefinition,
  unit: Unit,
  dest: string,
  destCoast: string | undefined,
): boolean {
  const destT = map.territories[dest]
  if (!destT) return false
  if (unit.type === 'army') return canMoveDirect(map, unit, dest)
  // fleet
  if (!canMoveDirect(map, unit, dest)) return false
  if (destT.coasts) {
    // a fleet moving to a multi-coast province must name a reachable coast
    const valid = landingCoasts(map, dest, unit.territory)
    if (valid.length === 0) return false
    if (!destCoast) return false // unspecified coast is illegal even if only one is reachable
    if (!valid.includes(destCoast)) return false
  }
  return true
}
