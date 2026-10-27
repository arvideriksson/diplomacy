// Ported from diplicity-react — builds a fresh SVG string from parsed dSVG + render state.
// The layer builders live in ./render; this module ties them to a parsed board.
import { parseDsvg, type ParsedDsvg } from './dsvgParser'
import { DEFAULT_THEME } from './theme'
import { HIGHLIGHTED_STRIPES_DEFS } from './render/constants'
import {
  proceduralBackground,
  proceduralCoastline,
  proceduralDefs,
  supplyCenterMarkersLayer,
  themedLabels,
} from './render/atmosphere'
import { provinceFillsLayer } from './render/fills'
import { unitsLayer } from './render/units'
import { ordersLayer } from './render/orders'
import { spotlightOverlayLayer, type SpotlightLayers } from './render/spotlight'
import type { RenderState } from './render/types'

export type { OrderState, RenderOrderType, RenderState, UnitState } from './render/types'
export type { SpotlightLayers } from './render/spotlight'
export { PULSE_CLASS } from './render/fills'

const layer = (id: string, markup: string): string => `<g id="${id}">${markup}</g>`

export type StaticLayers = { defs: string; rootFill: string | null; below: string; labels: string; above: string }
export type DynamicLayers = { fills: string; pulse: string; overlay: string }

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

  get unitPositions() {
    return this.parsed.unitPositions
  }

  /** Where a unit in `dsvgId` (a province or named coast) is drawn, in board units. */
  unitPosition(dsvgId: string): { x: number; y: number } | undefined {
    return this.parsed.unitPositions.get(dsvgId)
  }

  /**
   * The board's static art, which never changes during a game, as inner markup sharing
   * `defs`: `below` (sea/land/coast atmosphere) sits under the province fills; over them
   * come `labels` (supply-center markers, province names) then `above` (borders,
   * foreground). The component rasterizes `below`/`above` to bitmaps once, so their filters
   * and wave strokes are never re-run while panning, zooming or re-rendering orders.
   * `labels` stays live vector: it is cheap to paint, and a dsvg's embedded @font-face
   * loads asynchronously inside an SVG <img>, so rasterized text could come out blank.
   * Depends only on the map + theme.
   */
  renderStatic(state: RenderState = {}): StaticLayers {
    const { viewBox, defs, background, provinceNames, borders, foreground } = this.parsed
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
    const markers = supplyCenterMarkersLayer(this.parsed.supplyCenters, this.parsed.supplyCenterRadius)

    return {
      defs: defs + (procedural ? proceduralDefs(theme) : ''),
      rootFill: this.parsed.rootFill,
      below: layer('background', atmosphere),
      labels: [
        markers ? layer('supply-center-markers', markers) : '',
        layer('province-names', themedLabels(provinceNames, theme)),
      ].join('\n'),
      above: [layer('borders', borderLayer), layer('foreground', foregroundLayer)].join('\n'),
    }
  }

  /**
   * Everything that follows game state, split by z-order and update cadence: `fills`
   * (ownership tints, selection, hatch — between the static layers), `pulse` (breathing
   * highlight borders, mounted as their own opacity-animated layer) and `overlay`
   * (arrows, units, order markers — above all static art). `idPrefix` keeps generated
   * clip ids unique when several maps share a page.
   */
  renderDynamic(state: RenderState = {}, idPrefix = ''): DynamicLayers {
    const regionPaths = new Map([...this.parsed.provincePaths, ...this.parsed.namedCoastPaths])
    const { fills, pulse } = provinceFillsLayer(regionPaths, state, idPrefix)
    const units = unitsLayer(this.parsed.unitPositions, state)
    const orders = ordersLayer(this.parsed.unitPositions, state, this.parsed.routes)
    return {
      fills: (fills.includes('highlightedStripes') ? HIGHLIGHTED_STRIPES_DEFS : '') + fills,
      pulse,
      overlay: [
        orders.behind ? layer('order-arrows', orders.behind) : '',
        units ? layer('units', units) : '',
        orders.front ? layer('orders', orders.front) : '',
      ].join('\n'),
    }
  }

  /**
   * The spotlight veil for one nation, as standalone layers. Rendered separately from the
   * board so the component can mount it in a persistent layer and fade its opacity in/out —
   * keeping it with the board markup would recreate the node on every state change,
   * defeating any CSS transition.
   */
  renderSpotlight(state: RenderState = {}, idPrefix = ''): SpotlightLayers | null {
    const regionPaths = new Map([...this.parsed.provincePaths, ...this.parsed.namedCoastPaths])
    return spotlightOverlayLayer(
      regionPaths,
      this.parsed.unitPositions,
      state,
      this.parsed.viewBox,
      this.parsed.routes,
      idPrefix,
    )
  }
}

