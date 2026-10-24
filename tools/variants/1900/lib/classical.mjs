// Read the classical board's vector layers: province polygons, unplayable islands,
// supply-center positions, unit anchors, named coasts and individually placed labels.
import pc from 'polygon-clipping'
import { pathRings } from './svgpath.mjs'
import { attrs } from './source.mjs'
const pointsRing = (points) => {
  const n = points.trim().split(/[\s,]+/).map(Number), ring = []
  for (let i = 0; i + 1 < n.length; i += 2) ring.push([n[i], n[i + 1]])
  return ring
}
// Even-odd fill semantics: overlapping rings cancel, so lakes/holes survive.
const evenOdd = (rings) => rings.slice(1).reduce((acc, r) => pc.xor(acc, [[r]]), [[rings[0]]])

const layer = (svg, id) => {
  const start = svg.indexOf(`id="${id}"`)
  if (start < 0) throw new Error(`classical.dsvg has no ${id} layer`)
  const open = svg.lastIndexOf('<g', start)
  let depth = 0
  for (const m of svg.slice(open).matchAll(/<(\/?)g\b[^>]*?(\/?)>/g)) {
    if (m[2]) continue
    depth += m[1] ? -1 : 1
    if (!depth) return svg.slice(open, open + m.index + m[0].length)
  }
  throw new Error(`Unclosed layer ${id}`)
}

export function readClassical(svg) {
  const provinces = {}
  for (const m of layer(svg, 'provinces').matchAll(/<path\b([^>]+)>/g)) {
    const a = attrs(m[1]); provinces[a.id] = evenOdd(pathRings(a.d))
  }
  const namedCoasts = {}
  for (const m of layer(svg, 'named-coasts').matchAll(/<path\b([^>]+)>/g)) {
    const a = attrs(m[1]); namedCoasts[a.id] = evenOdd(pathRings(a.d))
  }
  const units = {}
  for (const m of layer(svg, 'unit-positions').matchAll(/<circle\b([^>]+)>/g)) {
    const a = attrs(m[1]); units[a.id] = [+a.cx, +a.cy]
  }
  const foreground = layer(svg, 'foreground')
  // Unplayable islands are striped shapes in the foreground (Iceland, Ireland, Switzerland, ...).
  const islands = [], islandMarkup = []
  for (const m of foreground.matchAll(/<(polygon|path)\b([^>]*impassableStripes[^>]*)>/g)) {
    const a = attrs(m[2])
    islands.push(evenOdd(m[1] === 'polygon' ? [pointsRing(a.points)] : pathRings(a.d)))
    islandMarkup.push(m[0])
  }
  // Classical's hand-drawn dashed sea borders, by id.
  const seaBorders = Object.fromEntries([...foreground.matchAll(/<path\b([^>]*stroke-dasharray:4[^>]*)>/g)].map((m) => [attrs(m[1]).id, m[0]]))
  const defs = svg.match(/<defs\b[\s\S]*?<\/defs>/)[0]
  // Supply-center bullseyes: groups of concentric circles, sometimes translated.
  const centers = []
  for (const m of foreground.matchAll(/<g\b([^>]*)>\s*(<circle[\s\S]*?)<\/g>/g)) {
    const t = attrs(m[1]).transform?.match(/translate\(([-\d.e]+),([-\d.e]+)\)/)
    const c = attrs(m[2].match(/<circle\b([^>]+)>/)[1])
    centers.push([+c.cx + (t ? +t[1] : 0), +c.cy + (t ? +t[2] : 0)])
  }
  // Labels: each <text> carries a rotation and its tspans' anchor points.
  const labels = []
  for (const m of layer(svg, 'province-names').matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = attrs(m[1]), angle = +(a.transform?.match(/rotate\(([-\d.e]+)/)?.[1] ?? 0) * Math.PI / 180
    const size = +(a.style?.match(/font-size:([\d.]+)px/)?.[1] ?? a['font-size'] ?? 16)
    const spans = [...m[2].matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>/g)].map((s) => ({ ...attrs(s[1]), text: s[2] }))
    // Center of the first line, rotated into board coordinates.
    const s0 = spans[0], w = s0.text.length * size * 0.55
    const lx = +s0.x + w / 2, ly = +s0.y - size * 0.35
    const at = [lx * Math.cos(angle) - ly * Math.sin(angle), lx * Math.sin(angle) + ly * Math.cos(angle)]
    labels.push({ markup: m[0], text: spans.map((s) => s.text).join(' '), at, size, angle: angle * 180 / Math.PI, style: a.style })
  }
  // The drawn board (background rect) is a unit narrower than the viewBox.
  const rect = attrs(svg.match(/<rect\b([^>]*id="background-rect"[^>]*)>/)[1])
  const width = +rect.width, height = +rect.height
  return { width, height, defs, seaBorders, provinces, namedCoasts, units, islands, islandMarkup, centers, labels }
}
