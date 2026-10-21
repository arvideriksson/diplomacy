// Draw the 1900 board in the classical board's style from the final partition:
// sea ground, blurred coast shadow, land fill, 1px land borders and coasts,
// dashed sea borders, striped unplayable islands, bullseye supply centers.
import { ringsPath } from './lib/svgpath.mjs'
import { readFileSync } from 'node:fs'
import { simplify, boundaryDistance, wiggle } from './lib/geom.mjs'

const SEA = '#d4d0ad', LAND = '#f4d7b5'
const FONT = "font-family:LibreBaskerville-Bold, 'Libre Baskerville', Georgia, serif"
const r2 = (n) => Math.round(n * 100) / 100
const polyline = (pts) => 'M' + pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join('L')
export const geomPath = (g) => ringsPath(g.flatMap((p) => p), 2)

const bullseye = ([x, y]) => {
  const c = 'mix-blend-mode:normal;fill:none;fill-opacity:0.7;stroke-linecap:round;stroke-opacity:0.7'
  return `<g transform="translate(${r2(x)},${r2(y)})"><circle r="10" style="${c};stroke:#000005;stroke-width:3.5"/><circle r="7.9344115" style="${c};stroke:#ffffff;stroke-width:1"/><circle r="5.8176403" style="${c};stroke:#000005;stroke-width:3.5"/><circle r="4.1615906" style="mix-blend-mode:normal;fill:#ffffff;fill-opacity:0.7;stroke:none"/></g>`
}

export function label({ text, at: [x, y], angle = 0, size = 16, kind = 'land' }) {
  const weight = kind === 'sc' ? 'font-weight:bold;' : 'font-style:italic;'
  const spacing = kind === 'sea' ? 'letter-spacing:2px;' : ''
  return `<text x="${r2(x)}" y="${r2(y)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${angle} ${r2(x)} ${r2(y)})" style="${weight}${spacing}font-size:${size}px;${FONT};fill:#000000">${kind === 'sea' ? text.toUpperCase() : text}</text>`
}

export const coastMark = ({ text, at: [x, y], angle = 0 }) =>
  `<text x="${r2(x)}" y="${r2(y)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${angle} ${r2(x)} ${r2(y)})" style="font-weight:bold;font-size:12px;${FONT};fill:#000000">${text}</text>`

// chains: shared-edge polylines; isSea(id) classifies provinces; ids starting '#' are drawn holes.
// Libre Baskerville (OFL), embedded so labels render the same everywhere.
const fontFace = () => {
  const data = (f) => readFileSync(new URL(`fonts/${f}`, import.meta.url)).toString('base64')
  return `<style>@font-face{font-family:'Libre Baskerville';font-style:normal;font-weight:400 700;src:url(data:font/woff2;base64,${data('LibreBaskerville-latin.woff2')}) format('woff2')}@font-face{font-family:'Libre Baskerville';font-style:italic;font-weight:400;src:url(data:font/woff2;base64,${data('LibreBaskerville-Italic-latin.woff2')}) format('woff2')}</style>`
}

// Compass rose: eight points, alternating ink and land halves, with a north mark.
const compass = ([x, y], r) => {
  const pts = []
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 - Math.PI / 2, len = k % 2 ? r * 0.55 : r, w = k % 2 ? r * 0.11 : r * 0.16
    const tip = [x + len * Math.cos(a), y + len * Math.sin(a)], l = [x + w * Math.cos(a - Math.PI / 2), y + w * Math.sin(a - Math.PI / 2)], rr = [x + w * Math.cos(a + Math.PI / 2), y + w * Math.sin(a + Math.PI / 2)]
    pts.push(`<path d="M${r2(x)} ${r2(y)}L${r2(l[0])} ${r2(l[1])}L${r2(tip[0])} ${r2(tip[1])}Z" style="fill:${LAND};stroke:#000;stroke-width:.8;stroke-linejoin:round"/><path d="M${r2(x)} ${r2(y)}L${r2(rr[0])} ${r2(rr[1])}L${r2(tip[0])} ${r2(tip[1])}Z" style="fill:#3a372b;stroke:#000;stroke-width:.8;stroke-linejoin:round"/>`)
  }
  return `<g><circle cx="${x}" cy="${y}" r="${r * 0.72}" style="fill:none;stroke:#000;stroke-width:.8"/><circle cx="${x}" cy="${y}" r="${r * 0.78}" style="fill:none;stroke:#000;stroke-width:.5"/>${pts.reverse().join('')}<text x="${x}" y="${y - r - 7}" text-anchor="middle" style="font-size:15px;font-weight:bold;${FONT}">N</text></g>`
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

// Chaikin corner cutting: rounds a polyline while keeping its end points.
const chaikin = (pts, rounds = 3) => {
  for (let k = 0; k < rounds; k++) {
    const out = [pts[0]]
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]]
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
    }
    out.push(pts.at(-1)); pts = out
  }
  return pts
}
// Borders that are not classical originals (new 1900 splits, real-world borders) are
// generalised and rounded so they read like the hand-drawn classical ones.
const smoothNew = (pts, isClassical, tolerance) => {
  const out = [], runs = []
  let run = [pts[0]], classical = isClassical(pts[0])
  for (const p of pts.slice(1)) {
    const c = isClassical(p)
    run.push(p)
    if (c !== classical) { runs.push([classical && c, run]); run = [p]; classical = c }
  }
  runs.push([classical, run])
  for (const [keep, r] of runs) {
    // Inland European cuts get a slight hand-drawn wobble so they don't read as ruled arcs.
    const wobble = (pts) => (tolerance(r) < 1 && pts.length > 1 ? wiggle(pts, { amplitude: 1.4, step: 4, seed: Math.round(pts[0][0] + pts[0][1]) }) : pts)
    const part = keep || r.length < 3 ? r : chaikin(wobble(simplify(r, tolerance(r))))
    out.push(...(out.length ? part.slice(1) : part))
  }
  return out
}

// Dashed double-headed arrow for an army crossing over water.
const crossing = ([a, b]) => `<path d="M${r2(a[0])} ${r2(a[1])}L${r2(b[0])} ${r2(b[1])}" style="fill:none;stroke:#000000;stroke-width:1.6;stroke-dasharray:3 2;marker-start:url(#crossing-head);marker-end:url(#crossing-head)"/>`

// waterParts: parts of land provinces that are drawn as water (the Strait of Gibraltar).
export function drawBoard({ width, height, defs, provinces, isSea, chains, islands, islandMarkup, centers, labels, isClassical = () => true, waterParts = [], canals = [], crossings = [], extraSeaBorders = [], style = {} }) {
  const land = Object.entries(provinces).filter(([id]) => !isSea(id))
  const kind = (id) => (id === null || id === '#frame' ? 'frame' : id.startsWith('#') ? 'hole' : isSea(id) ? 'sea' : 'land')
  const onWater = (pts) => waterParts.some((g) => pts.every((p) => boundaryDistance(g, p) < 0.2))
  const borders = [], coasts = [], seaLines = []
  for (const c of chains) {
    const a = kind(c.id), b = kind(c.other)
    const pts = unzig(simplify(c.points, 0.15))
    if (a === 'land' && b === 'sea' && waterParts.length) {
      // Split land–sea chains into runs along drawn water (the strait: dashed) and real coast.
      const wet = (p) => waterParts.some((g) => boundaryDistance(g, p) < 0.3)
      let run = [pts[0]], state = wet(pts[0])
      const flush = () => { if (run.length > 1) (state ? seaLines : coasts).push(run) }
      for (const p of pts.slice(1)) { const w = wet(p); run.push(p); if (w !== state) { flush(); run = [p]; state = w } }
      flush()
      continue
    }
    else if (a === 'land' && b === 'land' && c.id < c.other) borders.push(smoothNew(pts, isClassical, (r) => ([c.id, c.other].sort().join('|') === 'alg|tun' ? 3 : r.every(([x, y]) => y > 1250 || x > 1330) ? 1.2 : 0.5)))
    else if (a === 'land' && (b === 'sea' || b === 'hole')) coasts.push(pts)
    else if (a === 'sea' && b === 'sea' && c.id < c.other) seaLines.push(chaikin(simplify(pts, 2.5), 2))
  }
  const islandOutline = islands.map(geomPath).join('')
  const coastD = coasts.map(polyline).join('') + islandOutline
  // Water-lining: fine lines following the coast at increasing distance, fading outward.
  const waterLines = [[3, 0.42], [7, 0.3], [11.5, 0.2], [16.5, 0.12]].reverse().map(([d, o]) =>
    `<path d="${coastD}" style="fill:none;stroke:#7d7a5c;stroke-opacity:${o};stroke-width:${2 * d + 1.1};stroke-linejoin:round"/><path d="${coastD}" style="fill:none;stroke:${SEA};stroke-width:${2 * d - 0.1};stroke-linejoin:round"/>`).join('')
  const background = [
    `<rect width="${width}" height="${height}" style="fill:${SEA};stroke:#979797"/>`,
    waterLines,
    `<path d="${coastD}" style="fill:none;stroke:#000000;stroke-width:4;stroke-linejoin:round;filter:url(#filter848)"/>`,
    ...land.map(([, g]) => `<path d="${geomPath(g)}" style="fill:${LAND};fill-rule:evenodd;stroke:${LAND};stroke-width:0.6"/>`),
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
    style.compass ? compass(style.compass, 34) : '',
    style.neatline
      ? `<rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" style="fill:none;stroke:#000000;stroke-width:3"/><rect x="7" y="7" width="${width - 14}" height="${height - 14}" style="fill:none;stroke:#000000;stroke-width:0.8"/>`
      : `<rect width="${width}" height="${height}" style="fill:none;stroke:#000000;stroke-width:2"/>`,
  ].join('\n')
  defs = defs.replace('</defs>', '<marker id="crossing-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#000000"/></marker></defs>')
  return { defs: style.font ? defs.replace('</defs>', `${fontFace()}</defs>`) : defs, background, foreground, names: labels.join('\n') }
}
