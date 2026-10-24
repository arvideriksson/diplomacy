// Retreat-phase resolver (DATC 6.H). No supports. Two units retreating to the
// same province both disband. Unmatched / illegal / Disband orders disband.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { BoardState, OrderResult, RetreatOrder } from './types'
import { sortUnits } from './state'
import { directReach, landingCoasts } from './graph'
import { isLongRoute } from './rules'

export interface RetreatOutcome {
  units: Unit[]
  results: OrderResult[]
}

export function resolveRetreat(
  map: MapDefinition,
  board: BoardState,
  orders: RetreatOrder[],
): RetreatOutcome {
  const results: OrderResult[] = []
  const survivors: Unit[] = board.units.map((u) => ({ ...u }))
  const occupied = new Set(survivors.map((u) => u.territory))
  // Only the dislodged unit's own power may order it.
  const ownerOf = new Map(board.dislodged.map((d) => [d.unit.territory, d.unit.nation]))
  const byProvince = new Map<string, RetreatOrder>()
  for (const o of orders) if (o.nation === ownerOf.get(o.source)) byProvince.set(o.source, o)
  const dislodgedSet = new Set(board.dislodged.map((d) => d.unit.territory))

  // orders for units that weren't dislodged are illegal during a retreat phase
  for (const o of orders) {
    if (!dislodgedSet.has(o.source)) {
      results.push({ order: o, code: 'void', reason: 'no dislodged unit to retreat' })
    } else if (o.nation !== ownerOf.get(o.source)) {
      results.push({ order: o, code: 'void', reason: "ordering another power's unit" })
    }
  }

  interface Intent {
    dis: BoardState['dislodged'][number]
    dest: string
    coast?: string
    order: RetreatOrder
  }
  const intents: Intent[] = []

  for (const dis of board.dislodged) {
    const o = byProvince.get(dis.unit.territory)
    if (!o || o.type === 'Disband' || !o.target) {
      results.push({
        order: o ?? disbandOrder(dis.unit),
        code: 'disbanded',
        reason: o ? 'disband ordered' : 'no retreat ordered',
      })
      continue
    }
    if (!legalRetreat(map, dis, o.target, o.targetCoast, occupied, board.contested)) {
      results.push({ order: o, code: 'disbanded', reason: 'illegal retreat target' })
      continue
    }
    intents.push({ dis, dest: o.target, coast: o.targetCoast, order: o })
  }

  // bounces: >=2 retreats to the same province => all disband, except that a single
  // ordinary retreat beats competitors arriving along a long route (1900 Suez rule 8).
  const byDest = new Map<string, Intent[]>()
  for (const it of intents) byDest.set(it.dest, [...(byDest.get(it.dest) ?? []), it])
  const longRetreat = (it: Intent) => isLongRoute(map, it.dis.unit.territory, it.dest)

  for (const it of intents) {
    const rivals = byDest.get(it.dest) ?? []
    const ordinary = rivals.filter((r) => !longRetreat(r))
    const wins = rivals.length === 1 || (ordinary.length === 1 && ordinary[0] === it)
    if (!wins) {
      results.push({ order: it.order, code: 'disbanded', reason: 'retreats bounced' })
      continue
    }
    survivors.push({ ...it.dis.unit, territory: it.dest, coast: it.coast })
    results.push({ order: it.order, code: 'succeeds', reason: 'retreat succeeds' })
  }

  return { units: sortUnits(survivors), results }
}

function legalRetreat(
  map: MapDefinition,
  dis: BoardState['dislodged'][number],
  dest: string,
  coast: string | undefined,
  occupied: Set<string>,
  contested: string[],
): boolean {
  if (occupied.has(dest)) return false
  if (dest === dis.attackedFrom) return false
  if (contested.includes(dest)) return false
  if (!directReach(map, dis.unit).includes(dest)) return false
  const destT = map.territories[dest]
  if (dis.unit.type === 'fleet' && destT?.coasts) {
    const valid = landingCoasts(map, dest, dis.unit.territory)
    if (valid.length === 0) return false
    if (coast && !valid.includes(coast)) return false
    if (!coast && valid.length > 1) return false
  }
  return true
}

const disbandOrder = (u: Unit): RetreatOrder => ({
  type: 'Disband',
  nation: u.nation,
  source: u.territory,
})
