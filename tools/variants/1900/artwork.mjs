// Draw the 1900 board in the classical board's style from the final partition:
// sea ground, blurred coast shadow, land fill, 1px land borders and coasts,
// dashed sea borders, striped unplayable islands, bullseye supply centers.
import { ringsPath } from './lib/svgpath.mjs'
import { readFileSync } from 'node:fs'
import { simplify, boundaryDistance } from './lib/geom.mjs'

const SEA = '#d4d0ad', LAND = '#f4d7b5'
const FONT = "font-family:LibreBaskerville-Bold, 'Libre Baskerville', Georgia, serif"
// As on the classical board: regular italic province names and upright centre names (bold
// for the names in BOLD_NAMES).
// stroke:none opts out of the renderer's label halo, which the classical labels also do.
const NAME_FONT = "font-family:LibreBaskerville-Italic, 'Libre Baskerville', Georgia, serif"
const r2 = (n) => Math.round(n * 10) / 10
const polyline = (pts) => 'M' + pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join('L')
export const geomPath = (g) => ringsPath(g.flatMap((p) => p), 1)

const bullseye = ([x, y]) => {
  const c = 'mix-blend-mode:normal;fill:none;fill-opacity:0.7;stroke-linecap:round;stroke-opacity:0.7'
  return `<g transform="translate(${r2(x)},${r2(y)})"><circle r="10" style="${c};stroke:#000005;stroke-width:3.5"/><circle r="7.9344115" style="${c};stroke:#ffffff;stroke-width:1"/><circle r="5.8176403" style="${c};stroke:#000005;stroke-width:3.5"/><circle r="4.1615906" style="mix-blend-mode:normal;fill:#ffffff;fill-opacity:0.7;stroke:none"/></g>`
}

export function label({ text, at: [x, y], angle = 0, size = 16, kind = 'land', bold = false }) {
  const face = kind === 'sc' ? `font-weight:${bold ? 'bold' : 'normal'};${FONT}` : `font-style:italic;font-weight:normal;${NAME_FONT}`
  const spacing = kind === 'sea' ? 'letter-spacing:2px;' : ''
  return `<text x="${r2(x)}" y="${r2(y)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${angle} ${r2(x)} ${r2(y)})" style="${spacing}font-size:${size}px;${face};fill:#000000;stroke:none">${kind === 'sea' ? text.toUpperCase() : text}</text>`
}

export const coastMark = ({ text, at: [x, y], angle = 0 }) =>
  `<text x="${r2(x)}" y="${r2(y)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${angle} ${r2(x)} ${r2(y)})" style="font-weight:bold;font-size:12px;${FONT};fill:#000000;stroke:none">${text}</text>`

// chains: shared-edge polylines; isSea(id) classifies provinces; ids starting '#' are drawn holes.
// Libre Baskerville (OFL), embedded so labels render the same everywhere.
const fontFace = () => {
  const data = (f) => readFileSync(new URL(`fonts/${f}`, import.meta.url)).toString('base64')
  return `<style>@font-face{font-family:'Libre Baskerville';font-style:normal;font-weight:400 700;src:url(data:font/woff2;base64,${data('LibreBaskerville-latin.woff2')}) format('woff2')}@font-face{font-family:'Libre Baskerville';font-style:italic;font-weight:400;src:url(data:font/woff2;base64,${data('LibreBaskerville-Italic-latin.woff2')}) format('woff2')}</style>`
}

// Drop short out-and-back zigzags (a vertex where the line reverses within a few units).
const unzig = (pts) => {
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
export const offBoardNote = ({ text, at: [x, y], angle = 0, arrow: [[x1, y1], [x2, y2]] }) => {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 4.5, w = 2.6
  const tip = [x2, y2], l = [x2 - h * Math.cos(a) + w * Math.sin(a), y2 - h * Math.sin(a) - w * Math.cos(a)], r = [x2 - h * Math.cos(a) - w * Math.sin(a), y2 - h * Math.sin(a) + w * Math.cos(a)]
  return `<g><text x="${r2(x)}" y="${r2(y)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${r2(angle)} ${r2(x)} ${r2(y)})" style="font-style:italic;font-weight:normal;font-size:9px;letter-spacing:0.5px;${NAME_FONT};fill:#000000;stroke:none">${text}</text>` +
    `<path d="M${r2(x1)} ${r2(y1)}L${r2(x2 - h * Math.cos(a))} ${r2(y2 - h * Math.sin(a))}" style="fill:none;stroke:#000000;stroke-width:1.2"/>` +
    `<path d="M${r2(tip[0])} ${r2(tip[1])}L${r2(l[0])} ${r2(l[1])}L${r2(r[0])} ${r2(r[1])}Z" style="fill:#000000;stroke:none"/></g>`
}

// Dashed double-headed arrow for an army crossing over water.
const crossing = ([a, b]) => `<path d="M${r2(a[0])} ${r2(a[1])}L${r2(b[0])} ${r2(b[1])}" style="fill:none;stroke:#000000;stroke-width:1.6;stroke-dasharray:3 2;marker-start:url(#crossing-head);marker-end:url(#crossing-head)"/>`

// waterParts: parts of land provinces that are drawn as water (the Strait of Gibraltar).
export function drawBoard({ width, height, defs, provinces, isSea, chains, islands, islandMarkup, centers, labels, waterParts = [], canals = [], crossings = [], extraSeaBorders = [], style = {} }) {
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
    if (a === 'land' && b === 'sea' && waterParts.length) {
      // Split land–sea chains into runs along drawn water (the strait: dashed) and real coast.
      const wet = (p) => waterParts.some((g) => boundaryDistance(g, p) < 0.3)
      let run = [pts[0]], state = wet(pts[0])
      const flush = () => { if (run.length > 1) for (const r of offEdge(run)) (state ? seaLines : coasts).push(r) }
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
  const islandOutline = islands.map(geomPath).join('')
  const coastD = coasts.map(polyline).join('') + islandOutline
  // Water-lining: fine lines following the coast at increasing distance, fading outward.
  // The coastline is defined once (in defs) and reused by the shadow and water-lining.
  const coastUse = (style) => `<use href="#coast-line" style="${style}"/>`
  const waterLines = [[3, 0.42], [7, 0.3], [11.5, 0.2], [16.5, 0.12]].reverse().map(([d, o]) =>
    coastUse(`fill:none;stroke:#7d7a5c;stroke-opacity:${o};stroke-width:${2 * d + 1.1};stroke-linejoin:round`) + coastUse(`fill:none;stroke:${SEA};stroke-width:${2 * d - 0.1};stroke-linejoin:round`)).join('')
  const background = [
    `<rect width="${width}" height="${height}" style="fill:${SEA}"/>`,
    waterLines,
    coastUse('fill:none;stroke:#000000;stroke-width:4;stroke-linejoin:round;filter:url(#filter848)'),
    // All land as one shape (the province outlines live in the provinces layer).
    `<path d="${land.map(([id]) => outlinePath(id)).join('')}" style="fill:${LAND};stroke:${LAND};stroke-width:0.6"/>`,
    `<path d="${islandOutline}" style="fill:${LAND};fill-rule:evenodd"/>`,
    ...waterParts.map((g) => `<path d="${geomPath(g)}" style="fill:${SEA};fill-rule:evenodd"/>`),
    ...canals.map((c) => `<path d="${polyline(c)}" style="fill:none;stroke:#000000;stroke-width:3.4;stroke-linejoin:round;stroke-linecap:round"/><path d="${polyline(c)}" style="fill:none;stroke:${SEA};stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>`),
  ].join('\n')
  const foreground = [
    `<path d="${seaLines.map(polyline).join('')}" style="fill:none;stroke:#000000;stroke-width:1;stroke-dasharray:4"/>`,
    `<path d="${borders.map(polyline).join('')}" style="fill:none;stroke:#000000;stroke-width:1;stroke-linejoin:round"/>`,
    `<path d="${coasts.map(polyline).join('')}" style="fill:none;stroke:#000000;stroke-width:1;stroke-linejoin:round"/>`,
    ...extraSeaBorders,
    ...islandMarkup,
    ...crossings.map(crossing),
    ...centers.map(bullseye),
  ].join('\n')
  defs = defs.replace('</defs>', `<path id="coast-line" d="${coastD}"/></defs>`)
  defs = defs.replace('</defs>', '<marker id="crossing-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#000000"/></marker></defs>')
  return { defs: style.font ? defs.replace('</defs>', `${fontFace()}</defs>`) : defs, background, foreground, names: labels.join('\n'), outlinePath }
}
