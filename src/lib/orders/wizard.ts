// A small field-walking state machine for building one order, driven by map clicks.
// Mirrors the idea of diplicity's order wizard, but choices come from our own
// adjacency-derived options rather than a backend options tree.
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { Order, OrderType } from './types'
import { toDsvgId } from '../map/idMap'
import { isLongRoute } from '../adjudicator/rules'
import { unitAt } from '../adjudicator/state'
import type { OrderState } from '../map/mapRenderer'
import {
  moveTargets,
  reachableCoasts,
  supportAux,
  supportTargets,
  supportConvoyNext,
  convoyAux,
  convoyTargets,
  convoyNext,
} from './options'

export interface Draft {
  source: string
  sourceCoast?: string
  type?: OrderType
  target?: string
  targetCoast?: string
  aux?: string
  /**
   * Fleets chosen so far to convoy the army, in order (army → … → destination): the
   * moving army's own route, or for a support, the supported army's.
   */
  convoyPath?: string[]
}

export interface WizardContext {
  map: MapDefinition
  unit: Unit
  units: Unit[]
}

export interface Choice {
  /** Game province id. */
  id: string
  /** Named coast, when this choice is a specific landing coast. */
  coast?: string
  label: string
  /** Picking this choice adds a fleet to the convoy route instead of ending the move. */
  chain?: boolean
}

export type Step =
  | { kind: 'orderType'; prompt: string; orderTypes: OrderType[] }
  | { kind: 'province'; field: 'target' | 'aux' | 'coast'; prompt: string; choices: Choice[] }
  | { kind: 'done' }

const name = (map: MapDefinition, id: string): string => map.territories[id]?.name ?? id

const coastName = (map: MapDefinition, province: string, coast: string): string =>
  map.territories[province]?.coasts?.[coast]?.name ?? coast.toUpperCase()

const provinceChoices = (map: MapDefinition, ids: string[]): Choice[] =>
  ids.map((id) => ({ id, label: name(map, id) }))

export const applicableOrderTypes = (ctx: WizardContext): OrderType[] => {
  const { map, unit, units } = ctx
  const types: OrderType[] = ['Hold']
  if (moveTargets(map, unit).length > 0 || (unit.type === 'army' && convoyNext(map, unit.territory, [], units).fleets.length > 0)) types.push('Move')
  if (supportAux(map, unit, units).length > 0) types.push('Support')
  if (unit.type === 'fleet' && convoyAux(map, unit, units).length > 0) types.push('Convoy')
  return types
}

export const nextStep = (draft: Draft, ctx: WizardContext): Step => {
  const { map, unit, units } = ctx

  if (!draft.type) {
    return { kind: 'orderType', prompt: 'Choose an order', orderTypes: applicableOrderTypes(ctx) }
  }

  switch (draft.type) {
    case 'Hold':
      return { kind: 'done' }

    case 'Move': {
      if (!draft.target && unit.type === 'army') {
        // Armies: walkable neighbours, plus fleets that could start (or continue) a
        // convoy. Picking a fleet extends the route; the destinations then offered are
        // only those reachable from the last chosen fleet.
        const path = draft.convoyPath ?? []
        const next = convoyNext(map, unit.territory, path, units)
        const fleetChoices = next.fleets.map((id) => ({ id, label: `${name(map, id)} (convoy through)`, chain: true }))
        if (path.length) {
          return {
            kind: 'province',
            field: 'target',
            prompt: `Convoy via ${path.map((p) => name(map, p)).join(' → ')}: choose where to land, or another fleet`,
            choices: [...next.destinations.map((id) => ({ id, label: name(map, id) })), ...fleetChoices],
          }
        }
        const choices: Choice[] = moveTargets(map, unit).map((t) => ({ id: t.province, label: name(map, t.province) }))
        return { kind: 'province', field: 'target', prompt: fleetChoices.length ? 'Choose destination, or a fleet to convoy through' : 'Choose destination', choices: [...choices, ...fleetChoices] }
      }
      if (!draft.target) {
        // Destinations are coast-specific for multi-coast provinces: each reachable
        // coast is its own choice (highlighting that coast on the map), so picking a
        // coast is a single click — no separate coast step, even with one coast.
        const choices: Choice[] = []
        for (const t of moveTargets(map, unit)) {
          if (t.coasts.length > 0) {
            for (const c of t.coasts) {
              choices.push({
                id: t.province,
                coast: c,
                label: `${name(map, t.province)} (${coastName(map, t.province, c)})`,
              })
            }
          } else {
            const note = isLongRoute(map, unit.territory, t.province) ? ' (long route, half strength)' : ''
            choices.push({ id: t.province, label: `${name(map, t.province)}${note}` })
          }
        }
        return { kind: 'province', field: 'target', prompt: 'Choose destination', choices }
      }
      return { kind: 'done' }
    }

    case 'Support': {
      if (!draft.aux) {
        return {
          kind: 'province',
          field: 'aux',
          prompt: 'Choose a unit to support',
          choices: provinceChoices(map, supportAux(map, unit, units)),
        }
      }
      if (!draft.target) {
        // As for an army's move, a convoyed move is supported by walking its route
        // fleet by fleet; the destinations then offered are those reachable from the
        // last chosen fleet.
        const aux = unitAt(units, draft.aux)
        const path = draft.convoyPath ?? []
        const next = aux ? supportConvoyNext(map, unit, aux, path, units) : { fleets: [], destinations: [] }
        const fleetChoices = next.fleets.map((id) => ({ id, label: `${name(map, id)} (convoy through)`, chain: true }))
        if (path.length) {
          return {
            kind: 'province',
            field: 'target',
            prompt: `Convoy via ${path.map((p) => name(map, p)).join(' → ')}: choose where to support it into, or another fleet`,
            choices: [...provinceChoices(map, next.destinations), ...fleetChoices],
          }
        }
        const targets = aux ? supportTargets(map, unit, aux, units) : []
        return {
          kind: 'province',
          field: 'target',
          prompt: 'Tap the unit again to support it holding, or where it is moving',
          choices: [...provinceChoices(map, targets), ...fleetChoices],
        }
      }
      return { kind: 'done' }
    }

    case 'Convoy': {
      if (!draft.aux) {
        return {
          kind: 'province',
          field: 'aux',
          prompt: 'Choose an army to convoy',
          choices: provinceChoices(map, convoyAux(map, unit, units)),
        }
      }
      if (!draft.target) {
        const aux = unitAt(units, draft.aux)
        const targets = aux ? convoyTargets(map, unit, aux, units) : []
        return {
          kind: 'province',
          field: 'target',
          prompt: 'Choose destination',
          choices: provinceChoices(map, targets),
        }
      }
      return { kind: 'done' }
    }
  }
}

/** Build the final Order from a draft, auto-resolving a single forced coast. */
export const finalize = (draft: Draft, ctx: WizardContext): Order => {
  const order: Order = {
    type: draft.type as OrderType,
    nation: ctx.unit.nation,
    source: draft.source,
    sourceCoast: draft.sourceCoast,
    target: draft.target,
    targetCoast: draft.targetCoast,
    aux: draft.aux,
  }
  // A move routed through chosen fleets uses only that convoy route.
  if (order.type === 'Move' && draft.convoyPath?.length) order.viaConvoy = true
  if (order.type === 'Move' && ctx.unit.type === 'fleet' && order.target && !order.targetCoast) {
    const coasts = reachableCoasts(ctx.map, order.target, order.source)
    if (coasts.length === 1) order.targetCoast = coasts[0]
  }
  return order
}

/** Convert finished orders into renderer OrderStates (dSVG ids). */
export const toOrderStates = (orders: Order[]): OrderState[] =>
  orders.map((o) => {
    if (o.type === 'Support') {
      const aux = o.aux as string
      return {
        type: 'Support',
        nation: o.nation,
        source: toDsvgId(o.source), // support/convoy originate from the base province
        aux: toDsvgId(aux),
        target: toDsvgId(o.target ?? aux),
      }
    }
    if (o.type === 'Convoy') {
      return {
        type: 'Convoy',
        nation: o.nation,
        source: toDsvgId(o.source),
        aux: toDsvgId(o.aux as string),
        target: o.target ? toDsvgId(o.target) : undefined,
      }
    }
    if (o.type === 'Move') {
      // A move some fleet is ordered to convoy is drawn along the convoy route.
      const convoyed = o.viaConvoy || orders.some((c) => c.type === 'Convoy' && c.aux === o.source && c.target === o.target)
      return {
        type: convoyed ? 'MoveViaConvoy' : 'Move',
        nation: o.nation,
        source: toDsvgId(o.source, o.sourceCoast),
        target: toDsvgId(o.target as string, o.targetCoast),
      }
    }
    return { type: 'Hold', nation: o.nation, source: toDsvgId(o.source, o.sourceCoast) }
  })
