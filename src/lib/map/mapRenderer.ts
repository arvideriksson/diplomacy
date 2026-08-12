// Ported from diplicity-react — builds a fresh SVG string from parsed dSVG + render state.
import { parseDsvg, type ParsedDsvg, type Point } from './dsvgParser'
import {
  formatCoord,
  cross,
  minus,
  octagon,
  arrow,
  curvedArrow,
  supportHoldArrow,
  convoyArrow,
  moveViaConvoyArrow,
} from './svgPrimitives'
import {
  headToHeadControlPoint,
  staggeredSupportEnd,
  buildConvoyRoute,
  type ConvoyRoute,
} from './orderGeometry'
import { unitTokenSvg, unitOutlineSvg, DEFAULT_UNIT_STYLE, type UnitStyle } from './unitStyles'
import { DEFAULT_THEME, type MapTheme } from './theme'

export type UnitState = {
  province: string
  nation: string
  type: 'Army' | 'Fleet'
  dislodged?: boolean
  civilDisorder?: boolean
}

export type OrderType =
  | 'Hold'
  | 'Move'
  | 'MoveViaConvoy'
  | 'Support'
  | 'Convoy'
  | 'Build'
  | 'Disband'

export type OrderState = {
  type: OrderType
  nation: string
  source: string
  target?: string
  aux?: string
  unitType?: 'Army' | 'Fleet'
  failed?: boolean
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

const DEFAULT_FILL = 'transparent'
const SELECTED_FILL = 'rgba(255, 255, 255, 0.8)'
const SELECTED_STROKE_COLOR = 'white'
const HIGHLIGHTED_STROKE_COLOR = '#FFFFFF'
// Build/remove reuse the movement highlight's pulsing border, recoloured so the phases
// stay distinct: green = buildable, red = removable. No hatch overlay (movement only).
// The remove red is the OKLCH sibling of the green (L≈0.72 C≈0.175 h29 — same chroma,
// matched as close in lightness as red's gamut allows) so the pair feels coordinated.
const BUILD_HIGHLIGHT_COLOR = '#3ddc84'
const REMOVE_HIGHLIGHT_COLOR = '#ff7262'
// Amber border for own units that haven't been ordered yet — a "don't forget me" cue
// distinct from the white movement highlight and the green/red build markers. The third
// OKLCH sibling of the build/remove pair: same lightness as the green (L≈0.79), hue 80
// (amber, between the green's 154 and the red's 29), chroma at the gamut edge (C≈0.164)
// like the red — so all three "needs attention" cues read as one coordinated family.
const UNORDERED_HIGHLIGHT_COLOR = '#f2ad02'
// Spotlight (hovering a nation's badge in the SC card): a dark veil drops over the
// whole board with that nation's supply-center provinces punched out, so its holding
// stays fully lit while everything else recedes into shadow.
const SPOTLIGHT_SHADOW_COLOR = '#0b0e14'
const SPOTLIGHT_SHADOW_OPACITY = 0.55
const SELECTED_STROKE_WIDTH = 5
const HIGHLIGHTED_STROKE_WIDTH = 5
// Build/remove borders are drawn clipped to the province (inner stroke), so only the
// inner half shows — adjacent green/red highlights then meet at the shared edge instead
// of overpainting it. Width is doubled to compensate for clipping away the outer half.
const INNER_STROKE_WIDTH = 9
const DEFAULT_STROKE_WIDTH = 1
const SUPPLY_CENTER_OPACITY_ACTIVE = 0.3
const SUPPLY_CENTER_OPACITY_DEFAULT = 0.4
const NON_SC_PROVINCE_OPACITY_ACTIVE = 0.3
const NON_SC_PROVINCE_OPACITY_DEFAULT = 0.4

const UNIT_RADIUS = 11
const UNIT_OFFSET_RADIUS = 5
// A dislodged unit shares its province with the occupier that pushed it out, so it is
// drawn shifted down-right by enough that both tokens (radius 11) stay legible rather
// than stacking — the centers end up ~18px apart.
const DISLODGED_OFFSET = 13
// The spotlit nation's units get a pulsing white halo behind them (the unit and its addons
// are re-drawn over the veil). The chip is drawn in the 64-box then scaled to UNIT_RADIUS
// (a 0.5× shrink), so widths are doubled here to land at the same on-map size as the
// province border highlight.
const UNIT_OUTLINE_SCALE = 2
const SPOTLIGHT_UNIT_OUTLINE_WIDTH = HIGHLIGHTED_STROKE_WIDTH * UNIT_OUTLINE_SCALE
const SPOTLIGHT_UNIT_OUTLINE_PULSE = 2 * UNIT_OUTLINE_SCALE
const SUPPLY_CENTER_OUTER_RADIUS = 7
const SUPPLY_CENTER_INNER_RADIUS = 4
// Shared faded opacity for pending changes: a build ghost and a disbanding unit.
const GHOST_UNIT_OPACITY = 0.6

const ORDER_LINE_WIDTH = 3
const ORDER_ARROW_WIDTH = 6
const ORDER_ARROW_LENGTH = 8
const ORDER_STROKE_WIDTH = 2.5
const ORDER_DASH = { length: 4, spacing: 2 }
const SUCCESS_COLOR = 'rgba(0,0,0,1)'
const HOLD_OCTAGON_SIZE = 24
const FAILED_CROSS_WIDTH = 3
const FAILED_CROSS_LENGTH = 16
const FAILED_CROSS_ANGLE = 45
const ORDER_MARKER_WIDTH = 3
const ORDER_MARKER_LENGTH = 12
const ORDER_MARKER_ANGLE = 90
// Shared offset for the build "+" and the remove "−" so the two markers sit identically.
const BUILD_CROSS_OFFSET_X = 8
const BUILD_CROSS_OFFSET_Y = -8

const HIGHLIGHTED_STRIPES_DEFS =
  '<defs><pattern patternTransform="rotate(45)" height="8" width="8"' +
  ' patternUnits="userSpaceOnUse" id="highlightedStripes">' +
  '<line stroke-width="2" stroke-opacity="0.6" stroke="#FFFFFF"' +
  ' y2="8" x2="0" y1="0" x1="0"/></pattern></defs>'


const layer = (id: string, markup: string): string => `<g id="${id}">${markup}</g>`

// ── Procedural atmosphere ───────────────────────────────────────────────────────
// A map's look is generated from its geometry + a MapTheme, so any variant is
// presentable from pure data. Used when a dsvg supplies no hand-authored background
// (see render()); an artisanal dsvg with a baked background overrides all of this.

const proceduralDefs = (theme: MapTheme): string => {
  const defs: string[] = []
  if (theme.coast) {
    const { color, opacity, blur, dx, dy } = theme.coast
    defs.push(
      `<filter id="coastShadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
        `<feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur}" flood-color="${color}" flood-opacity="${opacity}"/>` +
        `</filter>`,
    )
  }
  // Coastline = the OUTLINE of the land silhouette. Dilate the land alpha and subtract
  // the original, so only the rim survives — internal province edges produce no line
  // (the union has no internal alpha gap), giving classical's clean coast over a quiet
  // interior. Applied to a group of all land paths (see proceduralCoastline).
  defs.push(
    `<filter id="coastline" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">` +
      `<feMorphology in="SourceAlpha" operator="dilate" radius="${theme.coastlineWidth}" result="d"/>` +
      `<feComposite in="d" in2="SourceAlpha" operator="out" result="rim"/>` +
      `<feFlood flood-color="${theme.coastline}"/>` +
      `<feComposite in2="rim" operator="in"/>` +
      `</filter>`,
  )
  return defs.join('')
}

/** Sea wash + land base (with a soft coastline shadow) generated from the geometry. */
const proceduralBackground = (
  provincePaths: Map<string, string>,
  landIds: Set<string>,
  viewBox: { minX: number; minY: number; width: number; height: number },
  theme: MapTheme,
): string => {
  // The converter grows each province so neighbours OVERLAP (truly tile — no gaps). Here
  // each province is drawn fill + a thin uniform border stroke, in order. Because the
  // shapes overlap, a later province's fill paints over the earlier neighbour's stroke,
  // so every shared edge shows exactly ONE line of uniform width — independent of how
  // uneven jDip's original gaps were. Seas first, then land (so land covers sea at the
  // coast); within each, draw order just decides which side's stroke wins (visually the
  // same uniform line either way).
  const stroke = `stroke="${theme.border}" stroke-width="${theme.borderWidth}" stroke-linejoin="round"`
  const base = `<rect x="${viewBox.minX}" y="${viewBox.minY}" width="${viewBox.width}" height="${viewBox.height}" fill="${theme.sea}"/>`
  const seaFills: string[] = []
  const land: string[] = []
  for (const [id, d] of provincePaths) {
    if (landIds.has(id)) land.push(`<path d="${d}" fill="${theme.land}" ${stroke}/>`)
    else seaFills.push(`<path d="${d}" fill="${theme.sea}" ${stroke}/>`)
  }
  const filter = theme.coast ? ' filter="url(#coastShadow)"' : ''
  return `${base}${seaFills.join('')}<g${filter}>${land.join('')}</g>`
}

/** Crisp coastline = the outline of the land silhouette, via the #coastline edge filter.
 *  All land paths go in one filtered group, so only the union's rim draws (no internal
 *  province edges). Sits in the foreground, like the classical map's coast strokes. */
const proceduralCoastline = (
  provincePaths: Map<string, string>,
  landIds: Set<string>,
  theme: MapTheme,
): string => {
  const land: string[] = []
  // Geometry is already grown to tile in the converter, so the land silhouette here
  // matches the land fill; the edge filter traces its outer rim as the coastline.
  for (const [id, d] of provincePaths) {
    if (landIds.has(id)) land.push(`<path d="${d}" fill="#000"/>`)
  }
  if (!land.length) return ''
  return `<g filter="url(#coastline)" pointer-events="none">${land.join('')}</g>`
}

/** Wrap the province-name markup in the theme's typography (with a legibility halo).
 *  Inline styles on individual labels — e.g. an artisanal dsvg's — override these. */
const themedLabels = (markup: string, theme: MapTheme): string => {
  const { family, size, weight, color, halo, haloWidth } = theme.label
  return (
    `<g font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${color}" ` +
    `paint-order="stroke" stroke="${halo}" stroke-width="${haloWidth}" stroke-linejoin="round">${markup}</g>`
  )
}

const sameNation = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const nationColor = (state: RenderState, nation: string): string => {
  const color = state.nationColors?.[nation]
  if (!color) {
    throw new Error(`No colour for nation "${nation}"`)
  }
  return color
}

const toRgba = (color: string, opacity: number): string => {
  const hex = color.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const r = parseInt(hex[1].slice(0, 2), 16)
    const g = parseInt(hex[1].slice(2, 4), 16)
    const b = parseInt(hex[1].slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }
  return color.replace(
    /rgb(a?)\((\d+), (\d+), (\d+)(, [\d.]+)?\)/,
    `rgba($2, $3, $4, ${opacity})`
  )
}

type ProvinceFill = {
  fill: string
  stroke: string
  strokeWidth: number
  selected: boolean
  highlighted: boolean
  /** Diagonal hatch overlay — movement highlights only; build/remove use the border alone. */
  stripe: boolean
  /** Clip the border to the province (inner stroke) — build/remove, so shared edges split. */
  inner: boolean
}

const provinceFill = (provinceId: string, state: RenderState): ProvinceFill => {
  const selected = state.selected?.includes(provinceId) ?? false
  const buildSlot = state.buildSlots?.includes(provinceId) ?? false
  const removeSlot = state.removeSlots?.includes(provinceId) ?? false
  const movementHl = state.highlighted?.includes(provinceId) ?? false
  // Unordered cue only when nothing more specific applies to this province.
  const unordered =
    (state.unorderedSlots?.includes(provinceId) ?? false) && !movementHl && !buildSlot && !removeSlot
  const highlighted = movementHl || buildSlot || removeSlot || unordered
  const owner = state.supplyCenters?.find((sc) => sc.province === provinceId)

  const highlightColor = removeSlot
    ? REMOVE_HIGHLIGHT_COLOR
    : buildSlot
      ? BUILD_HIGHLIGHT_COLOR
      : unordered
        ? UNORDERED_HIGHLIGHT_COLOR
        : HIGHLIGHTED_STROKE_COLOR

  let fill = DEFAULT_FILL
  if (owner) {
    const opacity =
      selected || highlighted ? SUPPLY_CENTER_OPACITY_ACTIVE : SUPPLY_CENTER_OPACITY_DEFAULT
    fill = toRgba(nationColor(state, owner.nation), opacity)
  } else if (state.nonScProvinceColors?.[provinceId]) {
    const opacity =
      selected || highlighted
        ? NON_SC_PROVINCE_OPACITY_ACTIVE
        : NON_SC_PROVINCE_OPACITY_DEFAULT
    fill = toRgba(state.nonScProvinceColors[provinceId], opacity)
  } else if (selected) {
    fill = SELECTED_FILL
  }

  let stroke = 'none'
  if (selected) {
    stroke = SELECTED_STROKE_COLOR
  } else if (highlighted) {
    stroke = highlightColor
  }

  const strokeWidth = selected
    ? SELECTED_STROKE_WIDTH
    : highlighted
      ? HIGHLIGHTED_STROKE_WIDTH
      : DEFAULT_STROKE_WIDTH

  // Only movement highlights get the hatch; build/remove are border-only.
  const stripe = movementHl && !buildSlot && !removeSlot
  // Build/remove/unordered borders are clipped to the province (inner stroke): the colour
  // glows inward from the edge. This groups the "needs attention" cues into one visual
  // language and lets adjacent build/remove highlights keep their colour on their own side.
  const inner = (buildSlot || removeSlot || unordered) && !selected

  return { fill, stroke, strokeWidth, selected, highlighted, stripe, inner }
}

const clipId = (id: string): string => `hlclip-${id.replace(/[^a-zA-Z0-9]/g, '-')}`

// A pulsing stroke-width animation, shared by the province highlights and the spotlit
// unit outline so both "breathe" in sync. `delta` is how much the width grows at the peak.
const PULSE_DUR = '2s'
const strokeWidthPulse = (base: number, delta = 2): string =>
  `<animate attributeName="stroke-width" values="${base};${base + delta};${base}" dur="${PULSE_DUR}" repeatCount="indefinite"/>`

const provinceFillsLayer = (
  regionPaths: Map<string, string>,
  state: RenderState
): string => {
  const defs: string[] = []
  const parts: string[] = []
  for (const [id, d] of regionPaths) {
    const style = provinceFill(id, state)
    if (style.fill === DEFAULT_FILL && style.stroke === 'none') {
      continue
    }
    if (style.inner) {
      // Inner stroke: clip the (over-wide) border to the province so only its inner half
      // shows. Neighbouring build/remove highlights then abut at the shared edge.
      const cid = clipId(id)
      defs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`)
      const w = INNER_STROKE_WIDTH
      parts.push(
        `<path d="${d}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${w}" clip-path="url(#${cid})">${strokeWidthPulse(w, 3)}</path>`
      )
      continue
    }
    const attributes = `d="${d}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"`
    if (style.highlighted && !style.selected) {
      parts.push(`<path ${attributes}>${strokeWidthPulse(HIGHLIGHTED_STROKE_WIDTH)}</path>`)
    } else {
      parts.push(`<path ${attributes}/>`)
    }
    if (style.stripe) {
      parts.push(
        `<path d="${d}" fill="url(#highlightedStripes)" stroke="none" pointer-events="none"/>`
      )
    }
  }
  return defs.join('') + parts.join('\n')
}

const supplyCenterMarkersLayer = (supplyCenters: Map<string, Point>): string => {
  const parts: string[] = []
  for (const [, position] of supplyCenters) {
    const cx = formatCoord(position.x)
    const cy = formatCoord(position.y)
    parts.push(
      `<g><circle cx="${cx}" cy="${cy}" r="${SUPPLY_CENTER_OUTER_RADIUS}" fill="white" stroke="black" stroke-width="2" opacity="0.8"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${SUPPLY_CENTER_INNER_RADIUS}" fill="white" stroke="black" stroke-width="2" opacity="0.8"/></g>`
    )
  }
  return parts.join('\n')
}

// Dark veil over the whole board with the spotlit nation's supply-center provinces punched
// out (mask: white = veil shows, black = hole). Drawn so it shadows fills, labels, borders,
// and other nations' units alike. On top of the veil we re-draw the spotlit nation's own
// units and order markers — reusing the exact same unitsLayer/ordersLayer paths as the main
// render — so every unit and *all* its addons (ghost-dimmed disband token + minus, retreat
// flag, build +, civil-disorder badge, support/move arrows…) appear identically, just lifted
// above the veil and undarkened, with a pulsing white halo behind each unit. The whole
// fragment rides one layer whose opacity the component fades in/out.
const spotlightOverlayLayer = (
  regionPaths: Map<string, string>,
  unitPositions: Map<string, Point>,
  state: RenderState,
  viewBox: { minX: number; minY: number; width: number; height: number },
): string => {
  if (!state.spotlightNation) return ''
  const style = state.unitStyle ?? DEFAULT_UNIT_STYLE
  const isSpotlit = (nation: string) => sameNation(nation, state.spotlightNation!)

  // Punch out the nation's supply-center provinces so its territory floods through in colour.
  const cuts: string[] = []
  for (const [id, d] of regionPaths) {
    const owner = state.supplyCenters?.find((sc) => sc.province === id)
    if (owner && isSpotlit(owner.nation)) cuts.push(`<path d="${d}" fill="black"/>`)
  }

  // The pulsing white halo behind each spotlit unit — drawn over the veil (so it stays bright)
  // but under the lifted unit token (so the token covers the inner half, leaving just the halo).
  const spotlitUnits = (state.units ?? []).filter((u) => isSpotlit(u.nation))
  const halos: string[] = []
  for (const unit of spotlitUnits) {
    const p = unitPositions.get(unit.province)
    if (!p) continue
    const offset = unit.dislodged ? DISLODGED_OFFSET : 0
    halos.push(
      unitOutlineSvg(
        p.x + offset, p.y + offset, unit.type, UNIT_RADIUS, style, '#fff',
        SPOTLIGHT_UNIT_OUTLINE_WIDTH,
        strokeWidthPulse(SPOTLIGHT_UNIT_OUTLINE_WIDTH, SPOTLIGHT_UNIT_OUTLINE_PULSE),
      ),
    )
  }
  if (cuts.length === 0 && halos.length === 0) return ''

  // The lifted copy of the spotlit nation's units and orders, rendered through the same code
  // paths as the main board so addons match exactly. State is filtered to the spotlit nation.
  const spotlitState: RenderState = {
    ...state,
    units: spotlitUnits,
    orders: state.orders?.filter((o) => isSpotlit(o.nation)),
  }
  const orders = ordersLayer(unitPositions, spotlitState)
  const units = unitsLayer(unitPositions, spotlitState)

  const rect = `x="${viewBox.minX}" y="${viewBox.minY}" width="${viewBox.width}" height="${viewBox.height}"`
  return (
    `<defs><mask id="spotlightMask"><rect ${rect} fill="white"/>${cuts.join('')}</mask></defs>` +
    `<rect ${rect} fill="${SPOTLIGHT_SHADOW_COLOR}" opacity="${SPOTLIGHT_SHADOW_OPACITY}" mask="url(#spotlightMask)" pointer-events="none"/>` +
    orders.behind + halos.join('') + units + orders.front
  )
}

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

const unitToken = (
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

const unitsLayer = (unitPositions: Map<string, Point>, state: RenderState): string => {
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

const failureCross = (x: number, y: number): string =>
  cross({
    x,
    y,
    width: FAILED_CROSS_WIDTH,
    length: FAILED_CROSS_LENGTH,
    angle: FAILED_CROSS_ANGLE,
    fill: 'red',
    stroke: 'black',
    strokeWidth: 2,
  })

const holdMarkup = (order: OrderState, position: Point): string =>
  octagon({
    x: position.x,
    y: position.y,
    size: HOLD_OCTAGON_SIZE,
    fill: 'transparent',
    stroke: SUCCESS_COLOR,
    strokeWidth: ORDER_LINE_WIDTH,
    renderBottomCenter: order.failed ? failureCross : undefined,
  })

const buildMarkup = (
  order: OrderState,
  position: Point,
  color: string,
  style: UnitStyle
): string => {
  const token = unitToken(
    position.x,
    position.y,
    order.unitType ?? 'Army',
    color,
    style,
    GHOST_UNIT_OPACITY
  )
  const marker = cross({
    x: position.x + BUILD_CROSS_OFFSET_X,
    y: position.y + BUILD_CROSS_OFFSET_Y,
    width: ORDER_MARKER_WIDTH,
    length: ORDER_MARKER_LENGTH,
    angle: ORDER_MARKER_ANGLE,
    fill: 'green',
    stroke: 'white',
    strokeWidth: 1,
  })
  return `<g>${token}${marker}</g>`
}

const headToHeadControlPoints = (
  orders: OrderState[],
  unitPositions: Map<string, Point>
): Map<string, Point> => {
  const moves = orders.filter(
    (order) => order.type === 'Move' || order.type === 'MoveViaConvoy'
  )
  const moveKeys = new Set(
    moves.filter((order) => order.target).map((order) => `${order.source}->${order.target}`)
  )
  const controlPoints = new Map<string, Point>()
  for (const order of moves) {
    if (!order.target) {
      continue
    }
    if (!moveKeys.has(`${order.target}->${order.source}`)) {
      continue
    }
    const source = unitPositions.get(order.source)
    const target = unitPositions.get(order.target)
    if (!source || !target) {
      continue
    }
    controlPoints.set(
      `${order.source}->${order.target}`,
      headToHeadControlPoint(source, target)
    )
  }
  return controlPoints
}

const supportMoveGroups = (orders: OrderState[]): Map<string, OrderState[]> => {
  const groups = new Map<string, OrderState[]>()
  for (const order of orders) {
    if (order.type !== 'Support' || !order.aux || !order.target) {
      continue
    }
    if (order.aux === order.target) {
      continue
    }
    const key = `${order.aux}->${order.target}`
    const group = groups.get(key)
    if (group) {
      group.push(order)
    } else {
      groups.set(key, [order])
    }
  }
  return groups
}

const convoyRoutes = (
  orders: OrderState[],
  unitPositions: Map<string, Point>
): Map<string, ConvoyRoute> => {
  const routes = new Map<string, ConvoyRoute>()
  const convoys = orders.filter((order) => order.type === 'Convoy')
  for (const move of orders) {
    if (move.type !== 'MoveViaConvoy' || !move.target) {
      continue
    }
    const source = unitPositions.get(move.source)
    const destination = unitPositions.get(move.target)
    if (!source || !destination) {
      continue
    }
    const fleets = convoys
      .filter((convoy) => convoy.aux === move.source && convoy.target === move.target)
      .map((convoy) => ({ id: convoy.source, point: unitPositions.get(convoy.source) }))
      .filter(
        (fleet): fleet is { id: string; point: Point } => fleet.point !== undefined
      )
    if (fleets.length === 0) {
      continue
    }
    routes.set(`${move.source}->${move.target}`, buildConvoyRoute(source, destination, fleets))
  }
  return routes
}

const supportOrderParts = (
  orders: OrderState[],
  unitPositions: Map<string, Point>,
  state: RenderState,
  groups: Map<string, OrderState[]>,
  headToHead: Map<string, Point>
): string[] => {
  const parts: string[] = []
  for (const order of orders) {
    if (order.type !== 'Support' || !order.target || !order.aux) {
      continue
    }
    const source = unitPositions.get(order.source)
    const target = unitPositions.get(order.target)
    const aux = unitPositions.get(order.aux)
    if (!source || !target || !aux) {
      continue
    }
    const color = nationColor(state, order.nation)
    const renderCenter = order.failed ? failureCross : undefined

    if (order.aux === order.target) {
      parts.push(
        supportHoldArrow({
          x1: source.x,
          y1: source.y,
          x2: target.x,
          y2: target.y,
          offset: UNIT_RADIUS,
          endOffset: UNIT_RADIUS + UNIT_OFFSET_RADIUS,
          lineWidth: ORDER_LINE_WIDTH,
          fill: color,
          stroke: SUCCESS_COLOR,
          strokeWidth: ORDER_STROKE_WIDTH,
          dash: ORDER_DASH,
          renderCenter,
        })
      )
      continue
    }

    const moveControlPoint = headToHead.get(`${order.aux}->${order.target}`)
    const group = groups.get(`${order.aux}->${order.target}`) ?? []
    const end = staggeredSupportEnd(aux, target, group.indexOf(order), moveControlPoint)
    parts.push(
      curvedArrow({
        x1: source.x,
        y1: source.y,
        x2: end.x,
        y2: end.y,
        x3: aux.x,
        y3: aux.y,
        offset: UNIT_RADIUS,
        lineWidth: ORDER_LINE_WIDTH,
        arrowWidth: ORDER_ARROW_WIDTH,
        arrowLength: ORDER_ARROW_LENGTH,
        strokeWidth: ORDER_STROKE_WIDTH,
        stroke: SUCCESS_COLOR,
        fill: color,
        dash: ORDER_DASH,
        endControlPoint: moveControlPoint,
        renderCenter,
      })
    )
  }
  return parts
}

const moveOrderParts = (
  orders: OrderState[],
  unitPositions: Map<string, Point>,
  state: RenderState,
  headToHead: Map<string, Point>,
  routes: Map<string, ConvoyRoute>
): string[] => {
  const parts: string[] = []
  for (const order of orders) {
    if (order.type !== 'Move' && order.type !== 'MoveViaConvoy') {
      continue
    }
    if (!order.target) {
      continue
    }
    const rawSource = unitPositions.get(order.source)
    const target = unitPositions.get(order.target)
    if (!rawSource || !target) {
      continue
    }
    // A retreat's tail starts at the dislodged token (offset), not the province center
    // where the occupier now sits — otherwise the arrow looks like it leaves the invader.
    const off = order.dislodged ? DISLODGED_OFFSET : 0
    const source = off ? { x: rawSource.x + off, y: rawSource.y + off } : rawSource
    const color = nationColor(state, order.nation)
    const renderCenter = order.failed ? failureCross : undefined

    if (order.type === 'MoveViaConvoy') {
      const route = routes.get(`${order.source}->${order.target}`)
      if (route) {
        parts.push(
          moveViaConvoyArrow({
            waypoints: route.waypoints,
            startOffset: 0,
            lineWidth: ORDER_LINE_WIDTH,
            arrowWidth: ORDER_ARROW_WIDTH,
            arrowLength: ORDER_ARROW_LENGTH,
            strokeWidth: ORDER_STROKE_WIDTH,
            offset: UNIT_RADIUS,
            stroke: SUCCESS_COLOR,
            fill: color,
            renderCenter,
          })
        )
        continue
      }
    }
    parts.push(
      arrow({
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y,
        lineWidth: ORDER_LINE_WIDTH,
        arrowWidth: ORDER_ARROW_WIDTH,
        arrowLength: ORDER_ARROW_LENGTH,
        strokeWidth: ORDER_STROKE_WIDTH,
        offset: UNIT_RADIUS,
        startOffset: 0, // tail begins at the unit center; the unit (drawn on top) covers it
        stroke: SUCCESS_COLOR,
        fill: color,
        controlPoint: headToHead.get(`${order.source}->${order.target}`),
        renderCenter,
      })
    )
  }
  return parts
}

const convoyOrderParts = (
  orders: OrderState[],
  unitPositions: Map<string, Point>,
  state: RenderState,
  routes: Map<string, ConvoyRoute>
): string[] => {
  const parts: string[] = []
  for (const order of orders) {
    if (order.type !== 'Convoy' || !order.target || !order.aux) {
      continue
    }
    const source = unitPositions.get(order.source)
    const target = unitPositions.get(order.target)
    const aux = unitPositions.get(order.aux)
    if (!source || !target || !aux) {
      continue
    }
    const route = routes.get(`${order.aux}->${order.target}`)
    parts.push(
      convoyArrow({
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y,
        x3: aux.x,
        y3: aux.y,
        lineWidth: ORDER_LINE_WIDTH,
        offset: UNIT_RADIUS,
        stroke: SUCCESS_COLOR,
        strokeWidth: ORDER_STROKE_WIDTH,
        fill: nationColor(state, order.nation),
        attachmentPoint: route?.attachments.get(order.source),
        renderCenter: order.failed ? failureCross : undefined,
      })
    )
  }
  return parts
}

// Orders split into two z-layers: `behind` (move arrows, drawn under the units so a
// triangular fleet's token cleanly covers the arrow's center-anchored tail) and
// `front` (everything else, drawn over the units as before).
const ordersLayer = (
  unitPositions: Map<string, Point>,
  state: RenderState
): { behind: string; front: string } => {
  const orders = state.orders ?? []
  const ofType = (type: OrderType): OrderState[] => orders.filter((order) => order.type === type)
  const headToHead = headToHeadControlPoints(orders, unitPositions)
  const groups = supportMoveGroups(orders)
  const routes = convoyRoutes(orders, unitPositions)
  const behind: string[] = moveOrderParts(orders, unitPositions, state, headToHead, routes)
  const front: string[] = []

  for (const order of ofType('Hold')) {
    const position = unitPositions.get(order.source)
    if (position) {
      front.push(holdMarkup(order, position))
    }
  }
  front.push(...supportOrderParts(orders, unitPositions, state, groups, headToHead))
  front.push(...convoyOrderParts(orders, unitPositions, state, routes))
  for (const order of ofType('Build')) {
    const position = unitPositions.get(order.source)
    if (position) {
      front.push(
        buildMarkup(order, position, nationColor(state, order.nation), state.unitStyle ?? DEFAULT_UNIT_STYLE)
      )
    }
  }
  // Disband is not drawn here: its "−" is a unit addon (see unitAddons), so the marker
  // tracks the exact token — including a dislodged unit offset beside its occupier — and
  // appears wherever the unit is redrawn (e.g. the spotlight overlay).
  return { behind: behind.join('\n'), front: front.join('\n') }
}

export class DiplicityMap {
  private readonly parsed: ParsedDsvg

  constructor(svg: string) {
    this.parsed = parseDsvg(svg)
  }

  get viewBox() {
    return this.parsed.viewBox
  }

  get provincePaths() {
    return this.parsed.provincePaths
  }

  get namedCoastPaths() {
    return this.parsed.namedCoastPaths
  }

  render(state: RenderState = {}): string {
    const { viewBox, rootFill, defs, background, provinceNames, borders, foreground } =
      this.parsed
    const viewBoxAttr = `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`
    const fillAttr = rootFill !== null ? ` fill="${rootFill}"` : ''
    const regionPaths = new Map([...this.parsed.provincePaths, ...this.parsed.namedCoastPaths])
    const fills = provinceFillsLayer(regionPaths, state)
    const markers = supplyCenterMarkersLayer(this.parsed.supplyCenters)
    const units = unitsLayer(this.parsed.unitPositions, state)
    const orders = ordersLayer(this.parsed.unitPositions, state)

    // An artisanal dsvg with a hand-authored background owns its whole look; otherwise
    // synthesize the atmosphere (sea/land/coast-shadow/borders) from geometry + theme.
    const theme = state.theme ?? DEFAULT_THEME
    const procedural = !background.trim()
    const landIds = new Set(state.landProvinces ?? [])
    const atmosphere = procedural
      ? proceduralBackground(this.parsed.provincePaths, landIds, viewBox, theme)
      : background
    // Procedural maps draw their borders as the bed behind the fills (see
    // proceduralBackground); only baked dsvgs carry an explicit borders layer.
    const borderLayer = procedural ? '' : borders
    const foregroundLayer = procedural
      ? proceduralCoastline(this.parsed.provincePaths, landIds, theme)
      : foreground

    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxAttr}"${fillAttr}>`,
      defs,
    ]
    if (procedural) {
      parts.push(proceduralDefs(theme))
    }
    if (fills.includes('highlightedStripes')) {
      parts.push(HIGHLIGHTED_STRIPES_DEFS)
    }
    parts.push(layer('background', atmosphere))
    if (fills) {
      parts.push(layer('province-fills', fills))
    }
    if (markers) {
      parts.push(layer('supply-center-markers', markers))
    }
    parts.push(layer('province-names', themedLabels(provinceNames, theme)))
    parts.push(layer('borders', borderLayer))
    parts.push(layer('foreground', foregroundLayer))
    if (orders.behind) {
      parts.push(layer('order-arrows', orders.behind))
    }
    if (units) {
      parts.push(layer('units', units))
    }
    if (orders.front) {
      parts.push(layer('orders', orders.front))
    }
    parts.push('</svg>')
    return parts.join('\n')
  }

  /**
   * The spotlight veil for one nation, as a standalone markup fragment (no <svg>
   * wrapper). Rendered separately from `render()` so the component can mount it in a
   * persistent layer and fade its opacity in/out — keeping it in the main string would
   * recreate the node on every state change, defeating any CSS transition.
   */
  renderSpotlight(state: RenderState = {}): string {
    const regionPaths = new Map([...this.parsed.provincePaths, ...this.parsed.namedCoastPaths])
    return spotlightOverlayLayer(
      regionPaths,
      this.parsed.unitPositions,
      state,
      this.parsed.viewBox,
    )
  }
}
