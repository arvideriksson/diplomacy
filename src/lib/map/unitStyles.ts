// Unit token styles — pluggable army/fleet glyphs for the map renderer.
//
// Shapes are authored in a normalised 64×64 box (chip disc r=22 centred at 32,32)
// and scaled down to the map's UNIT_RADIUS so every shape shares one footprint.
// The sandbox view (SandboxView.svelte) lets us swap styles live to compare them
// on the real board; the chosen style is held in src/lib/unitStyle.ts.

const BOX = 64
const BOX_C = 32
const BOX_R = 22 // chip radius in authoring space

export type ArmyStyleId =
  | 'disc-A'
  | 'disc-soldier'
  | 'disc-rook'
  | 'disc-star'
  | 'disc-swords'
  | 'disc'
  | 'square'
  | 'square-A'
  | 'hex'

export type FleetStyleId =
  | 'disc-F'
  | 'disc-sailboat'
  | 'disc-steamship'
  | 'disc-anchor'
  | 'disc-wave'
  | 'diamond'
  | 'hull'
  | 'hull-wave'
  | 'prow'
  | 'canoe'
  | 'capsule'
  | 'trap'
  | 'pennant'
  | 'shield'
  | 'chevron'
  | 'tri-up'
  | 'half-disc'
  // geometric sailboat family + extra geometric shapes
  | 'sail-sloop'
  | 'sail-single'
  | 'boat-origami'
  | 'boat-full'
  | 'compass'
  | 'arrow'
  | 'pentagon'
  | 'kite'
  | 'parallelogram'
  | 'trapezoid-up'
  | 'octagon'
  | 'chevron-right'
  | 'teardrop'

export type UnitStyle = {
  army: ArmyStyleId
  fleet: FleetStyleId
  /** Glyph/mark fill (letters, icons). */
  glyphFill: string
  /** Chip outline colour, or 'none'. */
  ring: string
}

export const DEFAULT_UNIT_STYLE: UnitStyle = {
  army: 'disc',
  fleet: 'tri-up',
  glyphFill: '#fff',
  ring: '#1a1a1a',
}

// ── chips (the coloured background shape) ─────────────────────────────
type Chip = (color: string, stroke: string) => string
const chip: Record<string, Chip> = {
  disc: (c, s) => `<circle cx="32" cy="32" r="22" fill="${c}" ${s}/>`,
  square: (c, s) => `<rect x="11" y="11" width="42" height="42" rx="9" fill="${c}" ${s}/>`,
  diamond: (c, s) => `<polygon points="32,8 56,32 32,56 8,32" fill="${c}" ${s}/>`,
  hull: (c, s) => `<path d="M11 25 H53 L46 48 Q32 56 18 48 Z" fill="${c}" ${s}/>`,
  prow: (c, s) => `<path d="M13 22 H51 V36 L32 55 L13 36 Z" fill="${c}" ${s}/>`,
  canoe: (c, s) => `<path d="M7 32 Q32 17 57 32 Q32 47 7 32 Z" fill="${c}" ${s}/>`,
  capsule: (c, s) => `<rect x="6" y="21" width="52" height="22" rx="11" fill="${c}" ${s}/>`,
  trap: (c, s) => `<polygon points="13,21 51,21 45,47 19,47" fill="${c}" ${s}/>`,
  pennant: (c, s) => `<polygon points="12,12 55,32 12,52" fill="${c}" ${s}/>`,
  shield: (c, s) => `<path d="M13 16 H51 V33 Q51 50 32 56 Q13 50 13 33 Z" fill="${c}" ${s}/>`,
  hex: (c, s) => `<polygon points="32,8 53,20 53,44 32,56 11,44 11,20" fill="${c}" ${s}/>`,
  chevron: (c, s) => `<polygon points="9,17 32,33 55,17 55,31 32,47 9,31" fill="${c}" ${s}/>`,
  triUp: (c, s) => `<polygon points="32,9 55,51 9,51" fill="${c}" ${s}/>`,
  halfdisc: (c, s) => `<path d="M11 28 H53 A21 21 0 0 1 11 28 Z" fill="${c}" ${s}/>`,

  // ── geometric sailboat family ──
  // Front-view sloop: jib (small, left) + mainsail (large, right) sharing a mast.
  sailSloop: (c, s) =>
    `<path d="M32 14 L32 47 L18 47 Z M32 12 L32 47 L50 47 Z" fill="${c}" ${s}/>`,
  // A single sail: vertical mast edge on the left, hypotenuse to the keel.
  sailSingle: (c, s) => `<polygon points="26,12 26,50 49,50" fill="${c}" ${s}/>`,
  // Origami boat: jib + mainsail over a trapezoid hull.
  boatOrigami: (c, s) =>
    `<path d="M32 13 L47 39 L32 39 Z M30 17 L19 39 L30 39 Z M14 41 H50 L44 52 H20 Z" fill="${c}" ${s}/>`,
  // Full sailboat: two sails over a hull — the most literal geometric ship.
  boatFull: (c, s) =>
    `<path d="M32 12 L32 40 L17 40 Z M32 12 L32 40 L48 40 Z M13 42 H51 L45 53 H19 Z" fill="${c}" ${s}/>`,

  // ── other geometric shapes ──
  compass: (c, s) =>
    `<polygon points="32,8 37,27 56,32 37,37 32,56 27,37 8,32 27,27" fill="${c}" ${s}/>`,
  arrow: (c, s) => `<polygon points="18,14 50,32 18,50" fill="${c}" ${s}/>`,
  pentagon: (c, s) => `<polygon points="32,10 52,25 44,52 20,52 12,25" fill="${c}" ${s}/>`,
  kite: (c, s) => `<polygon points="32,8 48,28 32,56 16,28" fill="${c}" ${s}/>`,
  parallelogram: (c, s) => `<polygon points="18,18 54,18 46,46 10,46" fill="${c}" ${s}/>`,
  trapezoidUp: (c, s) => `<polygon points="22,15 42,15 52,49 12,49" fill="${c}" ${s}/>`,
  octagon: (c, s) =>
    `<polygon points="22,11 42,11 53,22 53,42 42,53 22,53 11,42 11,22" fill="${c}" ${s}/>`,
  chevronRight: (c, s) =>
    `<path d="M14 16 L30 32 L14 48 L22 48 L38 32 L22 16 Z M28 16 L44 32 L28 48 L36 48 L52 32 L36 16 Z" fill="${c}" ${s}/>`,
  teardrop: (c, s) => `<path d="M32 54 C16 42 16 20 32 12 C48 20 48 42 32 54 Z" fill="${c}" ${s}/>`,
}

// ── marks (inner glyph, filled with the glyph colour `g`) ─────────────
type Mark = (g: string) => string
const letter = (ch: string): Mark => (g) =>
  `<text x="32" y="32" font-size="32" font-weight="700" fill="${g}" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif,system-ui,sans-serif">${ch}</text>`
const mark: Record<string, Mark> = {
  none: () => '',
  A: letter('A'),
  F: letter('F'),
  soldier: (g) => `<g fill="${g}"><circle cx="32" cy="26" r="5.6"/><path d="M21 45 a11 11 0 0 1 22 0 Z"/></g>`,
  rook: (g) =>
    `<path fill="${g}" d="M24 46 H40 V41 H37.5 V30 H40 V24 H35.5 V27.5 H33.5 V24 H30.5 V27.5 H28.5 V24 H24 V30 H26.5 V41 H24 Z"/>`,
  star: (g) =>
    `<path fill="${g}" d="M32 19 L35.06 27.79 L44.36 27.98 L36.95 33.61 L39.64 42.52 L32 37.2 L24.36 42.52 L27.05 33.61 L19.64 27.98 L28.94 27.79 Z"/>`,
  swords: (g) =>
    `<g stroke="${g}" stroke-width="3.4" stroke-linecap="round"><line x1="22" y1="22" x2="42" y2="42"/><line x1="42" y1="22" x2="22" y2="42"/></g>`,
  sailboat: (g) =>
    `<g fill="${g}"><path d="M32 14 L43 39 H32 Z"/><path d="M30 18 L21 39 H30 Z"/><path d="M17 40 H47 L42 48 H22 Z"/></g>`,
  steamship: (g) =>
    `<g fill="${g}"><path d="M16 40 H48 L43 47 H21 Z"/><rect x="27" y="29" width="11" height="10"/><rect x="30.5" y="22" width="5" height="8"/></g>`,
  anchor: (g) =>
    `<g stroke="${g}" stroke-width="2.8" fill="none" stroke-linecap="round"><circle cx="32" cy="16" r="3.2"/><line x1="32" y1="19" x2="32" y2="46"/><line x1="25" y1="26" x2="39" y2="26"/><path d="M21 38 a11 11 0 0 0 22 0"/></g>`,
  wave: () =>
    `<path d="M14 40 q6 -5 11 0 t11 0 t11 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
}

// ── option tables: id → {chip, mark, label}, also used to build menus ──
type Def = { id: string; chip: string; mark: string; label: string }
export const ARMY_DEFS: Def[] = [
  { id: 'disc-A', chip: 'disc', mark: 'A', label: 'Disc · letter A' },
  { id: 'disc-soldier', chip: 'disc', mark: 'soldier', label: 'Disc · soldier' },
  { id: 'disc-rook', chip: 'disc', mark: 'rook', label: 'Disc · rook/tower' },
  { id: 'disc-star', chip: 'disc', mark: 'star', label: 'Disc · star' },
  { id: 'disc-swords', chip: 'disc', mark: 'swords', label: 'Disc · crossed swords' },
  { id: 'disc', chip: 'disc', mark: 'none', label: 'Disc · plain' },
  { id: 'square', chip: 'square', mark: 'none', label: 'Square · plain' },
  { id: 'square-A', chip: 'square', mark: 'A', label: 'Square · letter A' },
  { id: 'hex', chip: 'hex', mark: 'none', label: 'Hexagon · plain' },
]
export const FLEET_DEFS: Def[] = [
  { id: 'disc-F', chip: 'disc', mark: 'F', label: 'Disc · letter F' },
  { id: 'disc-sailboat', chip: 'disc', mark: 'sailboat', label: 'Disc · sailboat' },
  { id: 'disc-steamship', chip: 'disc', mark: 'steamship', label: 'Disc · steamship' },
  { id: 'disc-anchor', chip: 'disc', mark: 'anchor', label: 'Disc · anchor' },
  { id: 'disc-wave', chip: 'disc', mark: 'wave', label: 'Disc · waterline' },
  { id: 'diamond', chip: 'diamond', mark: 'none', label: 'Diamond · plain' },
  { id: 'hull', chip: 'hull', mark: 'none', label: 'Hull bowl · plain' },
  { id: 'hull-wave', chip: 'hull', mark: 'wave', label: 'Hull bowl · waterline' },
  { id: 'prow', chip: 'prow', mark: 'none', label: 'Pointed prow · plain' },
  { id: 'canoe', chip: 'canoe', mark: 'none', label: 'Canoe/lens · plain' },
  { id: 'capsule', chip: 'capsule', mark: 'none', label: 'Long capsule · plain' },
  { id: 'trap', chip: 'trap', mark: 'none', label: 'Trapezoid tub · plain' },
  { id: 'pennant', chip: 'pennant', mark: 'none', label: 'Pennant · plain' },
  { id: 'shield', chip: 'shield', mark: 'none', label: 'Shield · plain' },
  { id: 'chevron', chip: 'chevron', mark: 'none', label: 'Chevron · plain' },
  { id: 'tri-up', chip: 'triUp', mark: 'none', label: 'Triangle prow · plain' },
  { id: 'half-disc', chip: 'halfdisc', mark: 'none', label: 'Half-disc · plain' },
  { id: 'sail-sloop', chip: 'sailSloop', mark: 'none', label: 'Sailboat · sloop (2 sails)' },
  { id: 'sail-single', chip: 'sailSingle', mark: 'none', label: 'Sailboat · single sail' },
  { id: 'boat-origami', chip: 'boatOrigami', mark: 'none', label: 'Sailboat · origami' },
  { id: 'boat-full', chip: 'boatFull', mark: 'none', label: 'Sailboat · full (sails + hull)' },
  { id: 'compass', chip: 'compass', mark: 'none', label: 'Compass star (4-point)' },
  { id: 'arrow', chip: 'arrow', mark: 'none', label: 'Arrow · heading' },
  { id: 'pentagon', chip: 'pentagon', mark: 'none', label: 'Pentagon · point up' },
  { id: 'kite', chip: 'kite', mark: 'none', label: 'Kite · tall rhombus' },
  { id: 'parallelogram', chip: 'parallelogram', mark: 'none', label: 'Parallelogram · wake' },
  { id: 'trapezoid-up', chip: 'trapezoidUp', mark: 'none', label: 'Trapezoid · sail' },
  { id: 'octagon', chip: 'octagon', mark: 'none', label: 'Octagon · plain' },
  { id: 'chevron-right', chip: 'chevronRight', mark: 'none', label: 'Double chevron · right' },
  { id: 'teardrop', chip: 'teardrop', mark: 'none', label: 'Teardrop · prow' },
]

const byId = (defs: Def[]) => Object.fromEntries(defs.map((d) => [d.id, d]))
const ARMY_BY_ID = byId(ARMY_DEFS)
const FLEET_BY_ID = byId(FLEET_DEFS)

/** Inner SVG (chip + glyph) for a style def, in the 64-box authoring space. */
function defMarkup(def: Def, color: string, style: UnitStyle): string {
  const stroke =
    style.ring === 'none' ? '' : `stroke="${style.ring}" stroke-width="4" stroke-linejoin="round"`
  return chip[def.chip](color, stroke) + mark[def.mark](style.glyphFill)
}

/**
 * A unit token positioned at (cx, cy) on the map, scaled to `radius`.
 * `radius` matches the legacy disc radius so footprints stay consistent.
 */
export function unitTokenSvg(
  cx: number,
  cy: number,
  type: 'Army' | 'Fleet',
  color: string,
  radius: number,
  style: UnitStyle,
  opacity = 1
): string {
  const def = type === 'Army' ? ARMY_BY_ID[style.army] : FLEET_BY_ID[style.fleet]
  const scale = radius / BOX_R
  const tx = cx - BOX_C * scale
  const ty = cy - BOX_C * scale
  const op = opacity === 1 ? '' : ` opacity="${opacity}"`
  return `<g transform="translate(${tx} ${ty}) scale(${scale})"${op}>${defMarkup(def, color, style)}</g>`
}

/**
 * The chip silhouette positioned at (cx, cy) and scaled to `radius` — the exact shape the
 * token uses, so it hugs an army's disc, a fleet's triangle, etc. Stroked (and optionally
 * filled), with `inner` injected inside the shape element (e.g. an <animate> for a pulsing
 * border). Used both for the white spotlight outline (fill 'none') and the matching black
 * veil cutout (fill '#000').
 */
export function unitOutlineSvg(
  cx: number,
  cy: number,
  type: 'Army' | 'Fleet',
  radius: number,
  style: UnitStyle,
  stroke: string,
  strokeWidth: number,
  inner = '',
  fill = 'none'
): string {
  const def = type === 'Army' ? ARMY_BY_ID[style.army] : FLEET_BY_ID[style.fleet]
  const scale = radius / BOX_R
  const tx = cx - BOX_C * scale
  const ty = cy - BOX_C * scale
  const el = chip[def.chip](fill, `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"`)
  // The chip is a single self-closing element; reopen it so `inner` (the pulse) sits inside.
  const tag = el.match(/^<(\w+)/)?.[1] ?? 'path'
  const open = inner ? el.replace(/\s*\/>\s*$/, `>${inner}</${tag}>`) : el
  return `<g transform="translate(${tx} ${ty}) scale(${scale})">${open}</g>`
}

/** Standalone preview token in its own <svg>, for menus/swatches. */
export function previewSvg(
  def: Def,
  color: string,
  style: UnitStyle,
  px: number
): string {
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${BOX} ${BOX}">${defMarkup(def, color, style)}</svg>`
}
