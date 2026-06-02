// Adapts this app's game types into the renderer's RenderState (with dSVG ids).
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../game'
import type { RenderState, UnitState, OrderState } from './mapRenderer'
import type { UnitStyle } from './unitStyles'
import { toDsvgId } from './idMap'

const normalize = (nation: string): string => nation.toLowerCase()

/** Resolve a nation token (power id or display name) to its colour. */
const makeColorResolver = (mapDef: MapDefinition) => {
  const byKey = new Map<string, string>()
  for (const power of mapDef.powers) {
    byKey.set(normalize(power.id), power.color)
    byKey.set(normalize(power.name), power.color)
  }
  return (nation: string): string | undefined => byKey.get(normalize(nation))
}

export type ToRenderStateInput = {
  mapDef: MapDefinition
  units?: Unit[]
  ownership?: Record<string, string>
  selectedTerritory?: string | null
  highlighted?: string[]
  buildSlots?: string[]
  removeSlots?: string[]
  unorderedSlots?: string[]
  orders?: OrderState[]
  unitStyle?: UnitStyle
}

export const toRenderState = (input: ToRenderStateInput): RenderState => {
  const {
    mapDef,
    units = [],
    ownership = {},
    selectedTerritory,
    highlighted = [],
    buildSlots = [],
    removeSlots = [],
    unorderedSlots = [],
    orders,
    unitStyle,
  } = input
  const resolveColor = makeColorResolver(mapDef)
  const nationColors: Record<string, string> = {}

  const register = (nation: string): string => {
    const color = resolveColor(nation)
    if (color) {
      nationColors[nation] = color
    }
    return nation
  }

  const unitStates: UnitState[] = units.map((unit) => ({
    province: toDsvgId(unit.territory, unit.coast),
    nation: register(unit.nation),
    type: unit.type === 'fleet' ? 'Fleet' : 'Army',
  }))

  const supplyCenters = Object.entries(ownership)
    .filter(([, power]) => Boolean(power))
    .map(([territory, power]) => ({
      province: toDsvgId(territory),
      nation: register(power),
    }))

  if (orders) {
    for (const order of orders) {
      register(order.nation)
    }
  }

  return {
    nationColors,
    units: unitStates,
    supplyCenters,
    orders,
    selected: selectedTerritory ? [toDsvgId(selectedTerritory)] : [],
    highlighted: highlighted.map((id) => toDsvgId(id)),
    buildSlots: buildSlots.map((id) => toDsvgId(id)),
    removeSlots: removeSlots.map((id) => toDsvgId(id)),
    unorderedSlots: unorderedSlots.map((id) => toDsvgId(id)),
    unitStyle,
  }
}
