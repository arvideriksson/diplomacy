// Render-state types: what the game layer hands the renderer (all ids in dSVG space).
import type { UnitStyle } from '../unitStyles'
import type { MapTheme } from '../theme'

export type UnitState = {
  province: string
  nation: string
  type: 'Army' | 'Fleet'
  dislodged?: boolean
  civilDisorder?: boolean
}

export type RenderOrderType =
  | 'Hold'
  | 'Move'
  | 'MoveViaConvoy'
  | 'Support'
  | 'Convoy'
  | 'Build'
  | 'Disband'

export type OrderState = {
  type: RenderOrderType
  nation: string
  source: string
  target?: string
  aux?: string
  unitType?: 'Army' | 'Fleet'
  failed?: boolean
  /** A failed support that was cut: drawn broken rather than slashed. */
  cut?: boolean
  /** Move arrow belongs to a dislodged unit (a retreat): the tail starts at the
   *  offset retreat token, not the province center the occupier now holds. */
  dislodged?: boolean
}

export type RenderState = {
  nationColors?: Record<string, string>
  supplyCenters?: { province: string; nation: string }[]
  nonScProvinceColors?: Record<string, string>
  units?: UnitState[]
  orders?: OrderState[]
  selected?: string[]
  highlighted?: string[]
  /** Open build centers — highlighted with the green variant of the movement highlight. */
  buildSlots?: string[]
  /** Removable units — highlighted with the red variant of the movement highlight. */
  removeSlots?: string[]
  /** Own units still awaiting an order — amber pulsing border so none are forgotten. */
  unorderedSlots?: string[]
  /** Nation id to spotlight: its supply centers flood-fill in colour, the rest dims. */
  spotlightNation?: string
  /** Army/fleet token style. Defaults to the classic disc + letter. */
  unitStyle?: UnitStyle
  /** Visual theme for procedurally-generated atmosphere (sea/land/borders/labels). */
  theme?: MapTheme
  /** dSVG ids of land+coast provinces — painted with the land base + coastline shadow.
   *  Everything else is treated as open sea. */
  landProvinces?: string[]
}
