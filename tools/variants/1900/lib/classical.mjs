// Read the classical board's vector layers: province polygons, unplayable islands,
// supply-center points, unit anchors, named coasts and labels (one group per name or coast mark).
import pc from 'polygon-clipping'
import { pathRings } from './svgpath.mjs'
import { attrs } from './xml.mjs'

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
  // Supply centers: points in the hidden supply-centers layer, keyed by province.
  const centerOf = {}
  for (const m of layer(svg, 'supply-centers').matchAll(/<circle\b([^>]+)>/g)) {
    const a = attrs(m[1]); centerOf[a.id] = [+a.cx, +a.cy]
  }
  const centers = Object.values(centerOf)
  // Labels: groups <g id="name:…|coast:…" transform="translate(x y) rotate(a)"> drawn around
  // their origin; `inner` is the group's content.
  const labels = []
  for (const m of layer(svg, 'province-names').matchAll(/<g id="([^"]+)" transform="translate\(([-\d.e]+) ([-\d.e]+)\)(?: rotate\(([-\d.e]+)\))?">([\s\S]*?)<\/g>/g)) {
    const [, id, x, y, angle = 0, inner] = m
    const text = attrs(inner.match(/<text\b([^>]*)>/)[1])
    const size = +(text.style?.match(/font-size:([\d.]+)px/)?.[1] ?? text['font-size'] ?? 16)
    const words = [...inner.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map((t) => t[1])
    labels.push({ id, inner, text: words.join(' '), at: [+x, +y], size, angle: +angle, style: text.style })
  }
  // The drawn board (background rect) is a unit narrower than the viewBox.
  const rect = attrs(svg.match(/<rect\b([^>]*id="background-rect"[^>]*)>/)[1])
  const width = +rect.width, height = +rect.height
  return { width, height, defs, seaBorders, provinces, namedCoasts, units, islands, islandMarkup, centers, centerOf, labels }
}
