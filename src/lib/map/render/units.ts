// Unit tokens and the addons (retreat flag, disband minus, civil-disorder badge) they carry.
import type { Point } from '../dsvgParser'
import { formatCoord, minus } from '../svgPrimitives'
import { unitTokenSvg, DEFAULT_UNIT_STYLE, type UnitStyle } from '../unitStyles'
import type { RenderState, UnitState } from './types'
import { nationColor } from './color'
import {
  UNIT_RADIUS,
  DISLODGED_OFFSET,
  GHOST_UNIT_OPACITY,
  ORDER_MARKER_WIDTH,
  ORDER_MARKER_LENGTH,
  ORDER_MARKER_ANGLE,
  BUILD_CROSS_OFFSET_X,
  BUILD_CROSS_OFFSET_Y,
} from './constants'

// ── Unit addons ────────────────────────────────────────────────────────────────
// Decorations layered onto a unit token (cx,cy are the token's already-offset centre).
// Every addon — and the single source of truth for *which* a unit shows — lives in
// `unitAddons` below, so the main board and the spotlight redraw stay in lockstep and a
// new badge is a one-line change rather than a hunt across render paths.

const retreatFlag = (cx: number, cy: number): string =>
  `<g transform="translate(${formatCoord(cx + 6)}, ${formatCoord(cy - 16)}) scale(1.5)">` +
  `<line x1="0" y1="0" x2="0" y2="12" stroke="black" stroke-width="2"/>` +
  `<path d="M 0 0 L 8 2 L 8 6 L 0 8 Z" fill="white" stroke="black" stroke-width="1"/></g>`

const civilDisorderBadge = (cx: number, cy: number): string =>
  `<g data-civil-disorder="true" transform="translate(${formatCoord(cx - 9)}, ${formatCoord(cy - 9)})">` +
  `<circle cx="0" cy="0" r="7" fill="white" stroke="black" stroke-width="1.5"/>` +
  `<g transform="translate(-5, -5) scale(0.417)" fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>` +
  `<circle cx="9" cy="7" r="4"/>` +
  `<line x1="17" x2="22" y1="8" y2="13"/>` +
  `<line x1="22" x2="17" y1="8" y2="13"/>` +
  `</g></g>`

// The red "−" of a disband, in the same slot the build "+" occupies on a ghost unit.
const disbandMinus = (cx: number, cy: number): string =>
  minus({
    x: cx + BUILD_CROSS_OFFSET_X,
    y: cy + BUILD_CROSS_OFFSET_Y,
    width: ORDER_MARKER_WIDTH,
    length: ORDER_MARKER_LENGTH,
    angle: ORDER_MARKER_ANGLE,
    fill: 'red',
    stroke: 'white',
    strokeWidth: 1,
  })

/**
 * The decorations a unit currently displays. This is the *only* place that maps unit +
 * order state to badges, so every render path that draws a token shows the same addons.
 * The disband "−" and the retreat flag are mutually exclusive (a unit being disbanded
 * isn't also being told to retreat), so the minus replaces the flag rather than stacking.
 */
const unitAddons = (unit: UnitState, disbanding: boolean, cx: number, cy: number): string => {
  const parts: string[] = []
  if (disbanding) parts.push(disbandMinus(cx, cy))
  else if (unit.dislodged) parts.push(retreatFlag(cx, cy))
  if (unit.civilDisorder && !disbanding) parts.push(civilDisorderBadge(cx, cy))
  return parts.join('')
}

export const unitToken = (
  cx: number,
  cy: number,
  type: 'Army' | 'Fleet',
  color: string,
  style: UnitStyle,
  opacity = 1
): string => unitTokenSvg(cx, cy, type, color, UNIT_RADIUS, style, opacity)

const unitMarkup = (
  unit: UnitState,
  position: Point,
  color: string,
  disbanding: boolean,
  style: UnitStyle
): string => {
  const offset = unit.dislodged ? DISLODGED_OFFSET : 0
  const cx = position.x + offset
  const cy = position.y + offset
  // A disbanding unit fades to the same ghost opacity as a pending build.
  const op = disbanding ? GHOST_UNIT_OPACITY : 1
  // The spotlit pulsing white outline is drawn on the separate spotlight layer (so it can
  // fade in/out), not here on the token itself — see spotlightOverlayLayer.
  const token = unitToken(cx, cy, unit.type, color, style, op)
  return `<g>${token}${unitAddons(unit, disbanding, cx, cy)}</g>`
}

export const unitsLayer = (unitPositions: Map<string, Point>, state: RenderState): string => {
  const style = state.unitStyle ?? DEFAULT_UNIT_STYLE
  const ordered = [...(state.units ?? [])].sort(
    (a, b) => Number(a.dislodged ?? false) - Number(b.dislodged ?? false)
  )
  // Keyed on province + dislodged so a retreat disband dims only the retreating token,
  // not the occupier sharing its province (and vice-versa for a build-phase remove).
  const disbandKey = (province: string, dislodged?: boolean) => `${province}|${dislodged ? 1 : 0}`
  const disbanding = new Set(
    (state.orders ?? [])
      .filter((order) => order.type === 'Disband')
      .map((order) => disbandKey(order.source, order.dislodged))
  )
  const parts: string[] = []
  for (const unit of ordered) {
    const position = unitPositions.get(unit.province)
    if (!position) {
      continue
    }
    parts.push(
      unitMarkup(unit, position, nationColor(state, unit.nation), disbanding.has(disbandKey(unit.province, unit.dislodged)), style)
    )
  }
  return parts.join('\n')
}
