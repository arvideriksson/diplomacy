// Build/disband phase (DATC 6.I / 6.J). Runs only after Fall retreats. Each
// nation adjusts toward `scCount - unitCount`; under-ordered removals trigger
// deterministic civil-disorder disbands.

import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { BoardState, BuildOrder, OrderResult } from './types'
import { homeCenters, scCountByNation, sortIds, sortUnits, unitCountByNation } from './state'

export interface BuildOutcome {
  units: Unit[]
  results: OrderResult[]
}

export function resolveBuild(
  map: MapDefinition,
  board: BoardState,
  orders: BuildOrder[],
): BuildOutcome {
  const owners = board.supplyCenters
  const scCount = scCountByNation(owners)
  const unitCount = unitCountByNation(board.units)
  const units: Unit[] = board.units.map((u) => ({ ...u }))
  const results: OrderResult[] = []
  const occupied = new Set(units.map((u) => u.territory))

  const nations = sortIds([...new Set([...Object.keys(scCount), ...Object.keys(unitCount)])])
  const ordersByNation = new Map<string, BuildOrder[]>()
  for (const o of orders) {
    const list = ordersByNation.get(o.nation) ?? []
    list.push(o)
    ordersByNation.set(o.nation, list)
  }

  for (const nation of nations) {
    const delta = (scCount[nation] ?? 0) - (unitCount[nation] ?? 0)
    const nationOrders = ordersByNation.get(nation) ?? []

    if (delta > 0) {
      const homes = homeCenters(map, nation).filter(
        (sc) => owners[sc] === nation && !occupied.has(sc),
      )
      let built = 0
      for (const o of nationOrders) {
        if (o.type !== 'Build') {
          results.push({ order: o, code: 'void', reason: 'not a build phase surplus' })
          continue
        }
        if (built >= delta) {
          results.push({ order: o, code: 'void', reason: 'exceeds allowed builds' })
          continue
        }
        if (!homes.includes(o.source) || occupied.has(o.source)) {
          results.push({ order: o, code: 'void', reason: 'not a buildable home center' })
          continue
        }
        const t = map.territories[o.source]
        if (o.unitType === 'fleet' && t.type !== 'coast') {
          results.push({ order: o, code: 'void', reason: 'cannot build fleet inland' })
          continue
        }
        if (o.unitType === 'fleet' && t.coasts && !o.sourceCoast) {
          results.push({ order: o, code: 'void', reason: 'fleet build needs a coast' })
          continue
        }
        units.push({
          type: o.unitType ?? 'army',
          nation,
          territory: o.source,
          coast: o.unitType === 'fleet' ? o.sourceCoast : undefined,
        })
        occupied.add(o.source)
        built++
        results.push({ order: o, code: 'succeeds', reason: 'unit built' })
      }
      // building fewer than allowed is legal (waive) — no further action
    } else if (delta < 0) {
      const need = -delta
      const removed = new Set<string>()
      for (const o of nationOrders) {
        if (o.type !== 'Remove') {
          results.push({ order: o, code: 'void', reason: 'removal required, not build' })
          continue
        }
        if (removed.size >= need) {
          results.push({ order: o, code: 'void', reason: 'too many removals' })
          continue
        }
        const idx = units.findIndex((u) => u.nation === nation && u.territory === o.source)
        if (idx < 0) {
          results.push({ order: o, code: 'void', reason: 'no such unit to remove' })
          continue
        }
        removed.add(o.source)
        results.push({ order: o, code: 'succeeds', reason: 'unit removed' })
      }
      // civil disorder: auto-remove the rest deterministically
      if (removed.size < need) {
        const candidates = units
          .filter((u) => u.nation === nation && !removed.has(u.territory))
          .sort(civilDisorderOrder(map, nation))
        for (let i = 0; removed.size < need && i < candidates.length; i++) {
          removed.add(candidates[i].territory)
        }
      }
      for (const prov of removed) {
        const idx = units.findIndex((u) => u.territory === prov && u.nation === nation)
        if (idx >= 0) units.splice(idx, 1)
      }
    } else {
      for (const o of nationOrders) {
        results.push({ order: o, code: 'void', reason: 'no adjustment owed' })
      }
    }
  }

  return { units: sortUnits(units), results }
}

/**
 * Civil-disorder ordering: remove units furthest from a home SC first, fleets
 * before armies on ties, then alphabetical province id (the deterministic
 * tiebreak where the rules leave the owner a choice).
 */
function civilDisorderOrder(map: MapDefinition, nation: string) {
  const homes = homeCenters(map, nation)
  const dist = (u: Unit): number => distanceToNearest(map, u, homes)
  return (a: Unit, b: Unit): number => {
    const da = dist(a)
    const db = dist(b)
    if (da !== db) return db - da // furthest first
    if (a.type !== b.type) return a.type === 'fleet' ? -1 : 1 // fleets first
    return a.territory < b.territory ? -1 : 1
  }
}

function distanceToNearest(map: MapDefinition, unit: Unit, homes: string[]): number {
  if (homes.includes(unit.territory)) return 0
  const visited = new Set([unit.territory])
  let frontier = [unit.territory]
  let d = 0
  while (frontier.length) {
    d++
    const next: string[] = []
    for (const p of frontier) {
      for (const n of map.territories[p]?.adjacent ?? []) {
        if (visited.has(n)) continue
        visited.add(n)
        if (homes.includes(n)) return d
        next.push(n)
      }
    }
    frontier = next.sort()
    if (d > 100) break
  }
  return 999
}
