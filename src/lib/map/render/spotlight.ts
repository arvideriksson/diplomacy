// The nation spotlight: a dark veil with that nation's centers punched out, plus its
// units and orders lifted above it.
import type { Point, ViewBox } from '../dsvgParser'
import { unitOutlineSvg, DEFAULT_UNIT_STYLE } from '../unitStyles'
import { sameNation } from '../../powers'
import type { RenderState } from './types'
import { ordersLayer } from './orders'
import { unitsLayer } from './units'
import {
  SPOTLIGHT_SHADOW_COLOR,
  SPOTLIGHT_SHADOW_OPACITY,
  UNIT_RADIUS,
  DISLODGED_OFFSET,
  SPOTLIGHT_UNIT_OUTLINE_WIDTH,
  SPOTLIGHT_UNIT_OUTLINE_PULSE,
} from './constants'

// Dark veil over the whole board with the spotlit nation's supply-center provinces punched
// out (mask: white = veil shows, black = hole). Drawn so it shadows fills, labels, borders,
// and other nations' units alike. On top of the veil we re-draw the spotlit nation's own
// units and order markers — reusing the exact same unitsLayer/ordersLayer paths as the main
// render — so every unit and *all* its addons (ghost-dimmed disband token + minus, retreat
// flag, build +, civil-disorder badge, support/move arrows…) appear identically, just lifted
// above the veil and undarkened, with a pulsing white halo behind each unit. The whole
// fragment rides one layer whose opacity the component fades in/out.
export type SpotlightLayers = {
  /** The dark veil (mask punched by the nation's centers) plus the nation's arrows over it. */
  veil: string
  /** Pulsing white halos behind the spotlit units — a separate layer so the pulse is composited. */
  halos: string
  /** The spotlit nation's units and front order markers, lifted above veil and halos. */
  lifted: string
}

export const spotlightOverlayLayer = (
  regionPaths: Map<string, string>,
  unitPositions: Map<string, Point>,
  state: RenderState,
  viewBox: ViewBox,
  fixedRoutes: Map<string, Point[][]> = new Map(),
  idPrefix = '',
): SpotlightLayers | null => {
  if (!state.spotlightNation) return null
  const style = state.unitStyle ?? DEFAULT_UNIT_STYLE
  const isSpotlit = (nation: string) => sameNation(nation, state.spotlightNation!)

  // Punch out the nation's supply-center provinces so its territory floods through in colour.
  const owners = new Map((state.supplyCenters ?? []).map((sc) => [sc.province, sc.nation]))
  const cuts: string[] = []
  for (const [id, d] of regionPaths) {
    const owner = owners.get(id)
    if (owner && isSpotlit(owner)) cuts.push(`<path d="${d}" fill="black"/>`)
  }

  // The white halo behind each spotlit unit — drawn over the veil (so it stays bright) but
  // under the lifted unit token (so the token covers the inner half, leaving just the halo).
  const spotlitUnits = (state.units ?? []).filter((u) => isSpotlit(u.nation))
  const halos: string[] = []
  for (const unit of spotlitUnits) {
    const p = unitPositions.get(unit.province)
    if (!p) continue
    const offset = unit.dislodged ? DISLODGED_OFFSET : 0
    halos.push(
      unitOutlineSvg(
        p.x + offset, p.y + offset, unit.type, UNIT_RADIUS, style, '#fff',
        SPOTLIGHT_UNIT_OUTLINE_WIDTH + SPOTLIGHT_UNIT_OUTLINE_PULSE / 2,
      ),
    )
  }
  if (cuts.length === 0 && halos.length === 0) return null

  // The lifted copy of the spotlit nation's units and orders, rendered through the same code
  // paths as the main board so addons match exactly. State is filtered to the spotlit nation.
  const spotlitState: RenderState = {
    ...state,
    units: spotlitUnits,
    orders: state.orders?.filter((o) => isSpotlit(o.nation)),
  }
  const orders = ordersLayer(unitPositions, spotlitState, fixedRoutes)
  const units = unitsLayer(unitPositions, spotlitState)

  const rect = `x="${viewBox.minX}" y="${viewBox.minY}" width="${viewBox.width}" height="${viewBox.height}"`
  const maskId = `${idPrefix}spotlightMask`
  return {
    veil:
      `<defs><mask id="${maskId}"><rect ${rect} fill="white"/>${cuts.join('')}</mask></defs>` +
      `<rect ${rect} fill="${SPOTLIGHT_SHADOW_COLOR}" opacity="${SPOTLIGHT_SHADOW_OPACITY}" mask="url(#${maskId})" pointer-events="none"/>` +
      orders.behind,
    halos: halos.join(''),
    lifted: units + orders.front,
  }
}
