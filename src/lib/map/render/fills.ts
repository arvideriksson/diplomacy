// Province fills (ownership tints, selection, hatch) and their pulsing highlight borders.
import type { RenderState } from './types'
import { nationColor, toRgba } from './color'
import {
  DEFAULT_FILL,
  SELECTED_FILL,
  SELECTED_STROKE_COLOR,
  HIGHLIGHTED_STROKE_COLOR,
  BUILD_HIGHLIGHT_COLOR,
  REMOVE_HIGHLIGHT_COLOR,
  UNORDERED_HIGHLIGHT_COLOR,
  SELECTED_STROKE_WIDTH,
  HIGHLIGHTED_STROKE_WIDTH,
  INNER_STROKE_WIDTH,
  DEFAULT_STROKE_WIDTH,
  SUPPLY_CENTER_OPACITY_ACTIVE,
  SUPPLY_CENTER_OPACITY_DEFAULT,
  NON_SC_PROVINCE_OPACITY_ACTIVE,
  NON_SC_PROVINCE_OPACITY_DEFAULT,
} from './constants'

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

// Per-render lookups for provinceFill, so each province is an O(1) probe rather than a scan of
// every slot list and the supply-center array.
type FillLookup = {
  selected: Set<string>
  buildSlots: Set<string>
  removeSlots: Set<string>
  highlighted: Set<string>
  unordered: Set<string>
  owners: Map<string, string>
}

const fillLookup = (state: RenderState): FillLookup => ({
  selected: new Set(state.selected),
  buildSlots: new Set(state.buildSlots),
  removeSlots: new Set(state.removeSlots),
  highlighted: new Set(state.highlighted),
  unordered: new Set(state.unorderedSlots),
  owners: new Map((state.supplyCenters ?? []).map((sc) => [sc.province, sc.nation])),
})

const provinceFill = (provinceId: string, state: RenderState, lookup: FillLookup): ProvinceFill => {
  const selected = lookup.selected.has(provinceId)
  const buildSlot = lookup.buildSlots.has(provinceId)
  const removeSlot = lookup.removeSlots.has(provinceId)
  const movementHl = lookup.highlighted.has(provinceId)
  // Unordered cue only when nothing more specific applies to this province.
  const unordered = lookup.unordered.has(provinceId) && !movementHl && !buildSlot && !removeSlot
  const highlighted = movementHl || buildSlot || removeSlot || unordered
  const ownerNation = lookup.owners.get(provinceId)

  const highlightColor = removeSlot
    ? REMOVE_HIGHLIGHT_COLOR
    : buildSlot
      ? BUILD_HIGHLIGHT_COLOR
      : unordered
        ? UNORDERED_HIGHLIGHT_COLOR
        : HIGHLIGHTED_STROKE_COLOR

  let fill = DEFAULT_FILL
  if (ownerNation) {
    const opacity =
      selected || highlighted ? SUPPLY_CENTER_OPACITY_ACTIVE : SUPPLY_CENTER_OPACITY_DEFAULT
    fill = toRgba(nationColor(state, ownerNation), opacity)
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

const clipId = (prefix: string, id: string): string => `${prefix}hlclip-${id.replace(/[^a-zA-Z0-9]/g, '-')}`

// Pulsing highlight borders "breathe" by opacity, not stroke-width: they are drawn into their own
// layer (`pulse`) which the component mounts as a separate <svg> and animates with CSS opacity,
// so the compositor runs the pulse without repainting the board every frame. The stroke sits
// midway through the old width swing so the border reads the same at its peak.
export const PULSE_CLASS = 'map-pulse'
const PULSE_WIDTH_BOOST = 1

/** Province fills (static, repainted only on state changes) and their pulsing borders. */
export const provinceFillsLayer = (
  regionPaths: Map<string, string>,
  state: RenderState,
  idPrefix: string,
): { fills: string; pulse: string } => {
  const lookup = fillLookup(state)
  const pulseDefs: string[] = []
  const pulse: string[] = []
  const fills: string[] = []
  for (const [id, d] of regionPaths) {
    const style = provinceFill(id, state, lookup)
    if (style.fill === DEFAULT_FILL && style.stroke === 'none') {
      continue
    }
    if (style.inner) {
      // Inner stroke: clip the (over-wide) border to the province so only its inner half
      // shows. Neighbouring build/remove highlights then abut at the shared edge.
      const cid = clipId(idPrefix, id)
      pulseDefs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`)
      if (style.fill !== DEFAULT_FILL) fills.push(`<path d="${d}" fill="${style.fill}"/>`)
      pulse.push(
        `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-width="${INNER_STROKE_WIDTH + PULSE_WIDTH_BOOST * 1.5}" clip-path="url(#${cid})"/>`
      )
      continue
    }
    if (style.highlighted && !style.selected) {
      if (style.fill !== DEFAULT_FILL) fills.push(`<path d="${d}" fill="${style.fill}"/>`)
      pulse.push(
        `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-width="${HIGHLIGHTED_STROKE_WIDTH + PULSE_WIDTH_BOOST}"/>`
      )
    } else {
      fills.push(`<path d="${d}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"/>`)
    }
    if (style.stripe) {
      fills.push(`<path d="${d}" fill="url(#highlightedStripes)" stroke="none" pointer-events="none"/>`)
    }
  }
  return {
    fills: fills.join('\n'),
    pulse: (pulseDefs.length ? `<defs>${pulseDefs.join('')}</defs>` : '') + pulse.join('\n'),
  }
}
