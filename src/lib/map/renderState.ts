// Adapts this app's game types into the renderer's RenderState (with dSVG ids).
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { RenderState, UnitState, OrderState } from './mapRenderer'
import type { UnitStyle } from './unitStyles'
import type { MapTheme } from './theme'
import { DEFAULT_THEME } from './theme'
import { toDsvgId } from './idMap'
import { powerColor } from '../powers'

export type ToRenderStateInput = {
  mapDef: MapDefinition
  units?: Unit[]
  /** Dislodged units awaiting retreat — drawn offset, with a retreat flag, on top of
   *  the new occupier that has taken their province (retreat phase only). */
  dislodged?: Unit[]
  ownership?: Record<string, string>
  selectedTerritory?: string | null
  highlighted?: string[]
  buildSlots?: string[]
  removeSlots?: string[]
  unorderedSlots?: string[]
  spotlightNation?: string
  orders?: OrderState[]
  unitStyle?: UnitStyle
  /** Visual theme for procedural atmosphere (sea/land/borders/labels). */
  theme?: MapTheme
}

export const toRenderState = (input: ToRenderStateInput): RenderState => {
  const {
    mapDef,
    units = [],
    dislodged = [],
    ownership = {},
    selectedTerritory,
    highlighted = [],
    buildSlots = [],
    removeSlots = [],
    unorderedSlots = [],
    spotlightNation,
    orders,
    unitStyle,
    theme = DEFAULT_THEME,
  } = input

  // Land + coast provinces (as dSVG ids) — what the renderer paints with the land
  // base colour and rings with the coastline shadow. Everything else is open sea.
  const landProvinces = Object.entries(mapDef.territories)
    .filter(([, t]) => t.type === 'land' || t.type === 'coast')
    .map(([id]) => toDsvgId(id))
  const nationColors: Record<string, string> = {}

  const register = (nation: string): string => {
    const color = powerColor(mapDef.powers, nation)
    if (color) {
      nationColors[nation] = color
    }
    return nation
  }

  const toUnitState = (unit: Unit, dislodged?: true): UnitState => ({
    province: toDsvgId(unit.territory, unit.coast),
    nation: register(unit.nation),
    type: unit.type === 'fleet' ? 'Fleet' : 'Army',
    ...(dislodged ? { dislodged } : {}),
  })

  // Dislodged units sit at their old province alongside the occupier that pushed them
  // out; the renderer offsets them and adds a retreat flag so the two read as distinct.
  const unitStates: UnitState[] = [
    ...units.map((unit) => toUnitState(unit)),
    ...dislodged.map((unit) => toUnitState(unit, true)),
  ]

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
    spotlightNation,
    unitStyle,
    theme,
    landProvinces,
  }
}
