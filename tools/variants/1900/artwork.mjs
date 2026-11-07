// Draw the 1900 board in the classical board's style from the final partition:
// sea ground, blurred coast shadow, land fill, 1px land borders and coasts,
// dashed sea borders and striped unplayable islands. Labels are separate groups (see `placed`)
// and supply centers a data layer the app draws.
import { ringsPath } from './lib/svgpath.mjs'
import { readFileSync } from 'node:fs'
import { simplify, boundaryDistance, subtract, intersect, union, area } from './lib/geom.mjs'

const SEA = '#d4d0ad', LAND = '#f4d7b5'
const FONT = "font-family:LibreBaskerville-Bold, 'Libre Baskerville', Georgia, serif"
// As on the classical board: regular italic province names and upright centre names (bold
// for the names in BOLD_NAMES).
// stroke:none opts out of the renderer's label halo, which the classical labels also do.
const NAME_FONT = "font-family:LibreBaskerville-Italic, 'Libre Baskerville', Georgia, serif"
const r2 = (n) => Math.round(n * 10) / 10
const polyline = (pts) => 'M' + pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join('L')
export const geomPath = (g) => ringsPath(g.flatMap((p) => p), 1)

// Every name, coast mark and note on a board is one group, `<g id="…" transform="translate(x y)
// rotate(a)">`, drawn around its own origin: moving or turning it rewrites only that transform
// (the layout editor at /editor does exactly that). Ids: name:<province>, coast:<province>/<coast>,
// note:<name>; a province's second name is name:<province>~2.
export const placed = ({ id, at: [x, y], angle = 0 }, inner) =>
  `<g id="${id}" transform="translate(${r2(x)} ${r2(y)})${angle ? ` rotate(${r2(angle)})` : ''}">${inner}</g>`

export function label({ id, text, at, angle = 0, size = 16, kind = 'land', bold = false }) {
  const face = kind === 'sc' ? `font-weight:${bold ? 'bold' : 'normal'};${FONT}` : `font-style:italic;font-weight:normal;${NAME_FONT}`
  const spacing = kind === 'sea' ? 'letter-spacing:2px;' : ''
  const lines = (kind === 'sea' ? text.toUpperCase() : text).split('\n')
  // Several lines (text with '\n'): centred on the origin, LINE_HEIGHT apart.
  const body = lines.length === 1 ? lines[0] : lines.map((t, i) => `<tspan x="0" dy="${r2(i ? size * LINE_HEIGHT : -(lines.length - 1) / 2 * size * LINE_HEIGHT)}">${t}</tspan>`).join('')
  return placed({ id, at, angle }, `<text text-anchor="middle" dominant-baseline="central" style="${spacing}font-size:${size}px;${face};fill:#000000;stroke:none">${body}</text>`)
}
export const LINE_HEIGHT = 1.1

export const coastMark = ({ id, text, at, angle = 0 }) =>
  placed({ id, at, angle }, `<text text-anchor="middle" dominant-baseline="central" style="font-weight:bold;font-size:12px;${FONT};fill:#000000;stroke:none">${text}</text>`)

// A note for a route that leaves the board: text at `at` (turned by `angle`) and an arrow, both
// drawn relative to the note's origin so the whole note moves as one.
export const offBoardNote = ({ id, text, at: [x, y], angle = 0, arrow: [[x1, y1], [x2, y2]] }) => {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 4.5, w = 2.6
  const rel = ([px, py]) => `${r2(px - x)} ${r2(py - y)}`
  const tip = [x2, y2], l = [x2 - h * Math.cos(a) + w * Math.sin(a), y2 - h * Math.sin(a) - w * Math.cos(a)], r = [x2 - h * Math.cos(a) - w * Math.sin(a), y2 - h * Math.sin(a) + w * Math.cos(a)]
  return placed({ id, at: [x, y] },
    `<text text-anchor="middle" dominant-baseline="central" transform="rotate(${r2(angle)})" style="font-style:italic;font-weight:normal;font-size:9px;letter-spacing:0.5px;${NAME_FONT};fill:#000000;stroke:none">${text}</text>` +
    `<path d="M${rel([x1, y1])}L${rel([x2 - h * Math.cos(a), y2 - h * Math.sin(a)])}" style="fill:none;stroke:#000000;stroke-width:1.2"/>` +
    `<path d="M${rel(tip)}L${rel(l)}L${rel(r)}Z" style="fill:#000000;stroke:none"/>`)
}

// Supply centers are data, not artwork: a hidden layer of points, one per province, which the
// app draws as bullseyes (src/lib/map/render/atmosphere.ts).
export const supplyCenterLayer = (centers, idOf = (id) => id) =>
  `<g id="supply-centers" style="display:none">\n${Object.entries(centers).map(([id, [x, y]]) => `<circle id="${idOf(id)}" cx="${r2(x)}" cy="${r2(y)}"/>`).join('')}\n</g>`

// chains: shared-edge polylines; isSea(id) classifies provinces; ids starting '#' are drawn holes.
// Libre Baskerville (OFL), embedded so labels render the same everywhere.
const fontFace = () => {
  const data = (f) => readFileSync(new URL(`fonts/${f}`, import.meta.url)).toString('base64')
  return `<style>@font-face{font-family:'Libre Baskerville';font-style:normal;font-weight:400 700;src:url(data:font/woff2;base64,${data('LibreBaskerville-latin.woff2')}) format('woff2')}@font-face{font-family:'Libre Baskerville';font-style:italic;font-weight:400;src:url(data:font/woff2;base64,${data('LibreBaskerville-Italic-latin.woff2')}) format('woff2')}</style>`
}

// Drop short out-and-back zigzags (a vertex where the line reverses within a few units).
let UNZIG = true
const unzig = (pts) => {
  if (!UNZIG) return pts
  let r = pts.slice()
  for (let pass = 0; pass < 3; pass++) {
    const out = [r[0]]
    for (let i = 1; i < r.length - 1; i++) {
      const a = out.at(-1), b = r[i], c = r[i + 1]
      const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]], lu = Math.hypot(...u), lv = Math.hypot(...v)
      if (lu < 6 && lv < 6 && lu * lv > 0 && (u[0] * v[0] + u[1] * v[1]) / (lu * lv) < -0.6) continue
      out.push(b)
    }
    out.push(r.at(-1)); r = out
  }
  return r
}

// A small note with an arrow, for routes that leave the board.

// Dashed double-headed arrow for an army crossing over water.
// The heads (4 × the 1.6 stroke) sit at the ends; the dashed shaft stops where they start.
const CROSSING_HEAD = 6.4
const crossing = ([a, b]) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / len * CROSSING_HEAD, (b[1] - a[1]) / len * CROSSING_HEAD]
  return `<path d="M${r2(a[0] + u[0])} ${r2(a[1] + u[1])}L${r2(b[0] - u[0])} ${r2(b[1] - u[1])}" style="fill:none;stroke:#000000;stroke-width:1.6;stroke-dasharray:3 2;marker-start:url(#crossing-head);marker-end:url(#crossing-head)"/>`
}

// waterParts: parts of land provinces that are drawn as water (the Strait of Gibraltar).
export function drawBoard({ width, height, defs, provinces, isSea, chains, islands, islandMarkup, labels, waterParts = [], canals = [], crossings = [], extraSeaBorders = [], style = {} }) {
  // Boards with narrow traced channels (Era of Empire) keep every vertex: unzig would close them.
  UNZIG = style.unzig !== false
  const land = Object.entries(provinces).filter(([id]) => !isSea(id))
  const kind = (id) => (id === null || id === '#frame' ? 'frame' : id.startsWith('#') ? 'hole' : isSea(id) ? 'sea' : 'land')
  // Segments lying on the board edge are never drawn: the board simply ends there.
  const onEdge = ([x, y]) => x < 2 || y < 2 || x > width - 2 || y > height - 2
  const offEdge = (pts) => {
    const runs = []
    let run = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      if (onEdge(pts[i - 1]) && onEdge(pts[i])) { if (run.length > 1) runs.push(run); run = [pts[i]] } else run.push(pts[i])
    }
    if (run.length > 1) runs.push(run)
    return runs
  }
  // Each shared edge is cleaned once, on its owner side (land before sea, then by id), and
  // the neighbour reuses that line reversed, so the province fills follow the drawn lines.
  const rank = { land: 0, sea: 1, hole: 2, frame: 3 }
  const owns = (c) => { const a = kind(c.id), b = kind(c.other); return c.other === null || c.other === '#frame' || rank[a] < rank[b] || (rank[a] === rank[b] && c.id < c.other) }
  const pair = (c) => [c.id, c.other].sort().join('|')
  const borders = [], coasts = [], seaLines = [], processed = new Map(), shaped = new Map()
  for (const c of chains.filter(owns)) {
    const a = kind(c.id), b = kind(c.other)
    const pts = unzig(simplify(c.points, 0.15))
    const line = a === 'land' || a === 'sea' ? pts : c.points
    if (a === 'land' && (b === 'sea' || b === 'land') && waterParts.length) {
      // Split chains into runs along drawn water (the strait) and the rest: a land–sea edge
      // there is a dashed sea line instead of coast, a land–land edge is coast instead of border.
      const wet = (p) => waterParts.some((g) => boundaryDistance(g, p) < 0.3)
      const [dry, damp] = b === 'sea' ? [coasts, seaLines] : [borders, coasts]
      let run = [pts[0]], state = wet(pts[0])
      const flush = () => { if (run.length > 1) for (const r of offEdge(run)) (state ? damp : dry).push(r) }
      for (const p of pts.slice(1)) { const w = wet(p); run.push(p); if (w !== state) { flush(); run = [p]; state = w } }
      flush()
    }
    else if (a === 'land' && b === 'land') borders.push(...offEdge(pts))
    // A gap in the partition (no neighbour) is open water too.
    else if (a === 'land' && (b === 'sea' || b === 'hole' || c.other === null)) coasts.push(...offEdge(pts))
    else if (a === 'sea' && b === 'sea') seaLines.push(...offEdge(pts))
    shaped.set(c, line)
    ;(processed.get(pair(c)) ?? processed.set(pair(c), []).get(pair(c))).push({ from: c.points[0], to: c.points.at(-1), line })
  }
  // The two sides of an edge can break at slightly different vertices; take the closest
  // owner line and pin its ends to this side's own corners.
  const gap = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])
  // An owner side may be split into several pieces (around tiny third neighbours); follow them.
  const follow = (pieces, from, to) => {
    let at = pieces.filter((e) => gap(e.from, from) < 8).sort((x, y) => gap(x.from, from) - gap(y.from, from))[0]
    const out = []
    for (let n = 0; at && n < pieces.length; n++) {
      out.push(...(out.length ? at.line.slice(1) : at.line))
      if (gap(at.to, to) < 8) return out
      const end = at.to
      at = pieces.filter((e) => e !== at && gap(e.from, end) < 8).sort((x, y) => gap(x.from, end) - gap(y.from, end))[0]
    }
    return null
  }
  for (const c of chains) if (!shaped.has(c)) {
    const start = c.points[0], end = c.points.at(-1)
    const line = follow(processed.get(pair(c)) ?? [], end, start)
    shaped.set(c, line && line.length > 2 ? [start, ...line.slice(1, -1).reverse(), end] : c.points)
  }
  // Province outlines rebuilt from the drawn lines, ring by ring.
  const outlines = {}
  for (const c of chains) {
    if (c.id.startsWith('#')) continue
    const polys = (outlines[c.id] ??= [])
    const rings = (polys[c.poly] ??= [])
    if (rings.lastRing !== c.ring) { rings.push([]); rings.lastRing = c.ring }
    const ring = rings.at(-1), line = shaped.get(c)
    ring.push(...(ring.length ? line.slice(1) : line))
  }
  const outlinePath = (id) => (outlines[id] ?? []).filter(Boolean).map((rings) => rings.map((r) => polyline(r) + 'Z').join('')).join('')
  // Drawn water reaches the province's drawn outline, not just its traced shape, so no sliver
  // of land fill (without water-lining) shows between the two.
  // The land fill leaves that water out, so its edge stroke cannot show past the outline.
  const outlineGeom = (id) => union(...outlines[id].filter(Boolean).map((rings) => [rings]))
  const landFill = {}
  const drawnWater = waterParts.map((g) => {
    const owner = land.find(([, geom]) => area(intersect(geom, g)) > area(g) / 2)
    if (!owner || !outlines[owner[0]]) return g
    try {
      const w = subtract(outlineGeom(owner[0]), subtract(owner[1], g))
      landFill[owner[0]] = geomPath(subtract(outlineGeom(owner[0]), w))
      return w
    } catch { return g }
  })
  // Where drawn water lies inside a land province, the land's edge along it is coast too.
  for (const g of waterParts) for (const [, geom] of land) {
    if (area(intersect(geom, g)) < 1) continue
    for (const ring of subtract(geom, g).filter((pl) => area([pl]) > 4).flat()) {
      let run = []
      for (const p of [...ring, ring[0]]) {
        if (boundaryDistance(g, p) < 0.3) run.push(p)
        else { if (run.length > 1) coasts.push(unzig(simplify(run, 0.15))); run = [] }
      }
      if (run.length > 1) coasts.push(unzig(simplify(run, 0.15)))
    }
  }
  const islandOutline = islands.map(geomPath).join('')
  const coastD = coasts.map(polyline).join('') + islandOutline
  // Water-lining: fine lines following the coast at increasing distance, fading outward.
  // The coastline is defined once (in defs) and reused by the shadow and water-lining.
  const coastUse = (style) => `<use href="#coast-line" style="${style}"/>`
  // Round caps: the coast is many open lines, and a flat cap would cut a seam across the bands where one ends.
  const waterLines = [[3, 0.42], [7, 0.3], [11.5, 0.2], [16.5, 0.12]].reverse().map(([d, o]) =>
    coastUse(`fill:none;stroke:#7d7a5c;stroke-opacity:${o};stroke-width:${2 * d + 1.1};stroke-linejoin:round;stroke-linecap:round`) + coastUse(`fill:none;stroke:${SEA};stroke-width:${2 * d - 0.1};stroke-linejoin:round;stroke-linecap:round`)).join('')
  const background = [
    `<rect width="${width}" height="${height}" style="fill:${SEA}"/>`,
    waterLines,
    coastUse('fill:none;stroke:#000000;stroke-width:4;stroke-linejoin:round;stroke-linecap:round;filter:url(#filter848)'),
    // All land as one shape (the province outlines live in the provinces layer).
    `<path d="${land.map(([id]) => landFill[id] ?? outlinePath(id)).join('')}" style="fill:${LAND};stroke:${LAND};stroke-width:0.6"/>`,
    `<path d="${islandOutline}" style="fill:${LAND};fill-rule:evenodd"/>`,
    ...drawnWater.map((g) => `<path d="${geomPath(g)}" style="fill:${SEA};fill-rule:evenodd"/>`),
    // The water-lining continues into the drawn water.
    waterParts.length ? `<g clip-path="url(#water-parts)">${waterLines}${coastUse('fill:none;stroke:#000000;stroke-width:4;stroke-linejoin:round;stroke-linecap:round;filter:url(#filter848)')}</g>` : '',
    ...canals.map((c) => `<path d="${polyline(c)}" style="fill:none;stroke:#000000;stroke-width:3.4;stroke-linejoin:round;stroke-linecap:round"/><path d="${polyline(c)}" style="fill:none;stroke:${SEA};stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>`),
  ].join('\n')
  const foreground = [
    `<path d="${seaLines.map(polyline).join('')}" style="fill:none;stroke:#000000;stroke-width:1;stroke-dasharray:4"/>`,
    `<path d="${borders.map(polyline).join('')}" style="fill:none;stroke:#000000;stroke-width:1;stroke-linejoin:round"/>`,
    `<path d="${coasts.map(polyline).join('')}" style="fill:none;stroke:#000000;stroke-width:1;stroke-linejoin:round"/>`,
    ...extraSeaBorders,
    ...islandMarkup,
    ...crossings.map(crossing),
  ].join('\n')
  defs = defs.replace('</defs>', `<path id="coast-line" d="${coastD}"/></defs>`)
  defs = defs.replace('</defs>', `<clipPath id="water-parts"><path d="${drawnWater.map(geomPath).join('')}" clip-rule="evenodd"/></clipPath></defs>`)
  defs = defs.replace('</defs>', '<marker id="crossing-head" viewBox="0 0 10 10" refX="0" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#000000"/></marker></defs>')
  return { defs: style.font ? defs.replace('</defs>', `${fontFace()}</defs>`) : defs, background, foreground, names: labels.join('\n'), outlinePath }
}
