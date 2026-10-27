// Sizes, colours and opacities shared by the render layers.

export const DEFAULT_FILL = 'transparent'
export const SELECTED_FILL = 'rgba(255, 255, 255, 0.8)'
export const SELECTED_STROKE_COLOR = 'white'
export const HIGHLIGHTED_STROKE_COLOR = '#FFFFFF'
// Build/remove reuse the movement highlight's pulsing border, recoloured so the phases
// stay distinct: green = buildable, red = removable. No hatch overlay (movement only).
// The remove red is the OKLCH sibling of the green (L≈0.72 C≈0.175 h29 — same chroma,
// matched as close in lightness as red's gamut allows) so the pair feels coordinated.
export const BUILD_HIGHLIGHT_COLOR = '#3ddc84'
export const REMOVE_HIGHLIGHT_COLOR = '#ff7262'
// Amber border for own units that haven't been ordered yet — a "don't forget me" cue
// distinct from the white movement highlight and the green/red build markers. The third
// OKLCH sibling of the build/remove pair: same lightness as the green (L≈0.79), hue 80
// (amber, between the green's 154 and the red's 29), chroma at the gamut edge (C≈0.164)
// like the red — so all three "needs attention" cues read as one coordinated family.
export const UNORDERED_HIGHLIGHT_COLOR = '#f2ad02'
// Spotlight (hovering a nation's badge in the SC card): a dark veil drops over the
// whole board with that nation's supply-center provinces punched out, so its holding
// stays fully lit while everything else recedes into shadow.
export const SPOTLIGHT_SHADOW_COLOR = '#0b0e14'
export const SPOTLIGHT_SHADOW_OPACITY = 0.55
export const SELECTED_STROKE_WIDTH = 5
export const HIGHLIGHTED_STROKE_WIDTH = 5
// Build/remove borders are drawn clipped to the province (inner stroke), so only the
// inner half shows — adjacent green/red highlights then meet at the shared edge instead
// of overpainting it. Width is doubled to compensate for clipping away the outer half.
export const INNER_STROKE_WIDTH = 9
export const DEFAULT_STROKE_WIDTH = 1
export const SUPPLY_CENTER_OPACITY_ACTIVE = 0.3
export const SUPPLY_CENTER_OPACITY_DEFAULT = 0.4
// Influence tint: well under the SC tint so owned centers still read as owned.
export const NON_SC_PROVINCE_OPACITY_ACTIVE = 0.12
export const NON_SC_PROVINCE_OPACITY_DEFAULT = 0.16

export const UNIT_RADIUS = 11
export const UNIT_OFFSET_RADIUS = 5
// A dislodged unit shares its province with the occupier that pushed it out, so it is
// drawn shifted down-right by enough that both tokens (radius 11) stay legible rather
// than stacking — the centers end up ~18px apart.
export const DISLODGED_OFFSET = 13
// The spotlit nation's units get a pulsing white halo behind them (the unit and its addons
// are re-drawn over the veil). The chip is drawn in the 64-box then scaled to UNIT_RADIUS
// (a 0.5× shrink), so widths are doubled here to land at the same on-map size as the
// province border highlight.
export const UNIT_OUTLINE_SCALE = 2
export const SPOTLIGHT_UNIT_OUTLINE_WIDTH = HIGHLIGHTED_STROKE_WIDTH * UNIT_OUTLINE_SCALE
export const SPOTLIGHT_UNIT_OUTLINE_PULSE = 2 * UNIT_OUTLINE_SCALE
export const SUPPLY_CENTER_OUTER_RADIUS = 7
export const SUPPLY_CENTER_INNER_RADIUS = 4
// Shared faded opacity for pending changes: a build ghost and a disbanding unit.
export const GHOST_UNIT_OPACITY = 0.8

export const ORDER_LINE_WIDTH = 3
export const SUCCESS_COLOR = 'rgba(0,0,0,1)'
// Move orders are drawn as solid ribbon arrows: one outlined shape with a broad head.
export const MOVE_SHAFT_WIDTH = 8
export const MOVE_HEAD_WIDTH = 9
export const MOVE_HEAD_LENGTH = 11
export const MOVE_OUTLINE_WIDTH = 1.5
// Supports and convoys share the shape, slimmer; supports have a dashed outline.
export const SUPPORT_SHAFT_WIDTH = 6
export const SUPPORT_HEAD_WIDTH = 7
export const SUPPORT_HEAD_LENGTH = 9
export const SUPPORT_DASH = { length: 3, spacing: 2 }
export const CONVOY_STUB_LENGTH = 28
export const HOLD_OCTAGON_SIZE = 24
// The failure slash overhangs a move shaft (8) by ~8 each side; the lean (degrees off the
// perpendicular) makes it a slash rather than a tick. A hold has no heading, so its slash
// leans the same amount off vertical: "/" through the octagon.
export const FAILED_SLASH_WIDTH = 3.5
export const FAILED_SLASH_LENGTH = 24
export const FAILED_SLASH_LEAN = 35
export const FAILED_COLOR = '#e5322d'
// A cut support is broken: its shaft parts by CUT_GAP at the centre and a red jag of
// CUT_JAG_HEIGHT spans the break, across the line.
export const CUT_GAP = 18
export const CUT_JAG_HEIGHT = 18
export const ORDER_MARKER_WIDTH = 3
export const ORDER_MARKER_LENGTH = 12
export const ORDER_MARKER_ANGLE = 90
// Shared offset for the build "+" and the remove "−" so the two markers sit identically.
export const BUILD_CROSS_OFFSET_X = 8
export const BUILD_CROSS_OFFSET_Y = -8

export const HIGHLIGHTED_STRIPES_DEFS =
  '<defs><pattern patternTransform="rotate(45)" height="8" width="8"' +
  ' patternUnits="userSpaceOnUse" id="highlightedStripes">' +
  '<line stroke-width="2" stroke-opacity="0.6" stroke="#FFFFFF"' +
  ' y2="8" x2="0" y1="0" x1="0"/></pattern></defs>'
