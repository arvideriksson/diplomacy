// A small field-walking state machine for building one order, driven by map clicks.
// Mirrors the idea of diplicity's order wizard, but choices come from our own
// adjacency-derived options rather than a backend options tree.
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../game'
import type { Order, OrderType } from './types'
import { toDsvgId } from '../map/idMap'
import type { OrderState } from '../map/mapRenderer'
import {
  moveTargets,
  reachableCoasts,
  supportAux,
  supportTargets,
  convoyAux,
  convoyTargets,
} from './options'

export interface Draft {
  source: string
  sourceCoast?: string
  type?: OrderType
  target?: string
  targetCoast?: string
  aux?: string
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
  if (moveTargets(map, unit).length > 0) types.push('Move')
  if (supportAux(map, unit, units).length > 0) types.push('Support')
  if (unit.type === 'fleet' && convoyAux(map, unit, units).length > 0) types.push('Convoy')
  return types
}

const auxUnit = (ctx: WizardContext, province: string): Unit | undefined =>
  ctx.units.find((u) => u.territory === province)

export const nextStep = (draft: Draft, ctx: WizardContext): Step => {
  const { map, unit, units } = ctx

  if (!draft.type) {
    return { kind: 'orderType', prompt: 'Choose an order', orderTypes: applicableOrderTypes(ctx) }
  }

  switch (draft.type) {
    case 'Hold':
      return { kind: 'done' }

    case 'Move': {
      if (!draft.target) {
        const choices = moveTargets(map, unit).map((t) => ({ id: t.province, label: name(map, t.province) }))
        return { kind: 'province', field: 'target', prompt: 'Choose destination', choices }
      }
      const coasts = reachableCoasts(map, draft.target, draft.source)
      if (coasts.length > 1 && !draft.targetCoast) {
        return {
          kind: 'province',
          field: 'coast',
          prompt: 'Choose coast',
          choices: coasts.map((c) => ({
            id: draft.target as string,
            coast: c,
            label: coastName(map, draft.target as string, c),
          })),
        }
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
        const aux = auxUnit(ctx, draft.aux)
        const targets = aux ? supportTargets(map, unit, aux, units) : []
        return {
          kind: 'province',
          field: 'target',
          prompt: 'Choose what to support',
          choices: provinceChoices(map, targets),
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
        const aux = auxUnit(ctx, draft.aux)
        const targets = aux ? convoyTargets(map, unit, aux) : []
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
  if (order.type === 'Move' && order.target && !order.targetCoast) {
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
      return {
        type: 'Move',
        nation: o.nation,
        source: toDsvgId(o.source, o.sourceCoast),
        target: toDsvgId(o.target as string, o.targetCoast),
      }
    }
    return { type: 'Hold', nation: o.nation, source: toDsvgId(o.source, o.sourceCoast) }
  })
