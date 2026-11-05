/** Build the Era of Empire board (public/maps/era.dsvg) in the classical board's style.
 * Run: npm run map:era
 *
 * The province partition comes from source/geometry.json, traced from the published board
 * (see trace/README.md). The drawing reuses the 1900 board's artwork, so all three boards
 * share one look: parchment land and sea, blurred coast shadow with water-lining, 1px land
 * borders, dashed sea borders, bullseye supply centers and Libre Baskerville labels.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readClassical } from '../1900/lib/classical.mjs'
import { sharedEdges } from '../1900/lib/edges.mjs'
import { drawBoard, geomPath, label } from '../1900/artwork.mjs'
import { union, intersect, subtract, poly, contains, pole, area, boundaryDistance } from '../1900/lib/geom.mjs'
import { LabelPlacer, labelBox } from '../1900/lib/labels.mjs'
import { LABELS, BOLD_NAMES, UNITS, IMPASSABLE_ISLETS, CENTER_AT } from './layout.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const G = JSON.parse(readFileSync(resolve(here, 'source/geometry.json'), 'utf8'))
const { width, height } = G
const SEA = new Set(G.sea)
const ids = Object.keys(G.provinces)

// Province geometry. Cebu is islands inside a ring of water that belongs to the province (drawn
// as sea, its edge a dashed sea border, like 1900's Strait of Gibraltar).
const P = { ...G.provinces }
P.CEB = union(P.CEB, G.cebuWater)
// The Suez Canal is cut through Egypt as narrow water, as on the 1900 board; Egypt stays one
// province on both banks.
const channel = (pts, w) => {
  const side = (s) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1])
    return [p[0] - s * w / 2 * (b[1] - a[1]) / len, p[1] + s * w / 2 * (b[0] - a[0]) / len]
  })
  return poly([...side(1), ...side(-1).reverse()])
}
const extend = (pts, d) => {
  const out = (p, q) => { const len = Math.hypot(p[0] - q[0], p[1] - q[1]); return [p[0] + (p[0] - q[0]) / len * d, p[1] + (p[1] - q[1]) / len * d] }
  return [out(pts[0], pts[1]), ...pts, out(pts.at(-1), pts.at(-2))]
}
const suezCanal = intersect(channel(extend(G.suez, 14), 3), P.EGY)
P.EGY = subtract(P.EGY, suezCanal)
// The Himalayas are impassable land: filled as land, bordered, striped, never a province.
const HIM = '~him'
P[HIM] = G.himalaya
const isSea = (id) => SEA.has(id)

const classical = readClassical(readFileSync(resolve(root, 'public/maps/classical.dsvg'), 'utf8'))
// Islets: each belongs to a province (it is shaded and clickable with it) but stays out of the
// movement graph, which is read from the provinces' main shapes only.
const centroid = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]
const impassable = (i) => { const [x, y] = centroid(i.poly[0]); return IMPASSABLE_ISLETS.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1) }
// Islets are solid: drop interior rings (outline artefacts traced as holes).
for (const i of G.islands) i.poly = [i.poly[0]]
const ISLANDS = G.islands.map((i) => [i.poly])
const isletsOf = (id) => G.islands.filter((i) => i.owner === id && !impassable(i)).map((i) => [i.poly])
const holes = [...G.lakes, ...ISLANDS, suezCanal]
const { chains, gaps, lengths } = sharedEdges({ ...P, ...Object.fromEntries(holes.map((g, i) => [`#hole${i}`, g])) }, { frame: [0, 0, width, height] })
const gapLength = gaps.reduce((s, g) => s + g.len, 0)
if (gapLength > 1) console.warn(`warning: unmatched boundary ${gapLength.toFixed(1)} units, e.g. ${gaps.slice(0, 4).map((g) => `${g.id}@${g.at.map(Math.round)}`).join(' ')}`)

// --- Labels: placed inside their province near the published board's own label, clear of
// borders and supply centers. Supply-center names are upright (capitals bold), other land
// names italic, seas italic capitals, as on the classical board.
// Supply centers sit on the published board's stars; a bullseye (radius 10) is larger than a
// star, so one near a coast moves inland until it clears the coast.
const centers = {}
for (const [id, c] of Object.entries(G.centers)) {
  if (CENTER_AT[id]) { centers[id] = CENTER_AT[id]; continue }
  if (boundaryDistance(P[id], c) >= 12) { centers[id] = c; continue }
  let best = c, bd = -1
  for (let dx = -14; dx <= 14; dx++) for (let dy = -14; dy <= 14; dy++) {
    const p = [c[0] + dx, c[1] + dy]
    if (!contains(P[id], p)) continue
    const d = Math.min(boundaryDistance(P[id], p), 12) - Math.hypot(dx, dy) * 0.05
    if (d > bd) { bd = d; best = p }
  }
  centers[id] = best
}
const placer = new LabelPlacer()
for (const c of Object.values(centers)) placer.blockCircle(c, 12)
// Strait arrows: labels keep clear of them.
for (const [a, b] of Object.values(G.arrows)) for (let t = 0; t <= 1; t += 0.05) placer.blockCircle([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], 4)
const labels = [], labelRects = [], problems = []
const order = ids.slice().sort((a, b) => area(P[a]) - area(P[b]))
for (const id of order) {
  const hint = LABELS[id] ?? {}
  const kind = isSea(id) ? 'sea' : centers[id] ? 'sc' : 'land'
  const text = hint.text ?? G.names[id]
  const l = { text, kind, size: isSea(id) ? 16 : 17, minSize: 10, margin: 3, at: G.seeds[id][0], angle: 0, ...hint }
  const geom = P[id]
  const spot = l.fixed ? (placer.blockLabel(l.at, labelBox(l).w, l.size * 0.8, l.angle), { at: l.at, angle: l.angle, size: l.size }) : placer.place(geom, l, pole(geom).point)
  if (!spot) { problems.push(`no room for the ${text} label`); continue }
  labels.push(label({ ...l, ...spot, bold: BOLD_NAMES.has(text) }))
  labelRects.push({ at: spot.at, w: labelBox({ ...l, size: spot.size }).w, h: spot.size * 0.8, angle: spot.angle })
}

// --- Unit anchors: the most open spot of each province's largest piece, clear of its label
// and supply center (a unit token has radius 11).
const rectDistance = (p, { at, w, h, angle }) => {
  const a = -angle * Math.PI / 180, dx = p[0] - at[0], dy = p[1] - at[1]
  const u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.hypot(Math.max(0, Math.abs(u) - w / 2), Math.max(0, Math.abs(v) - h / 2))
}
const units = {}
for (const id of ids) {
  if (UNITS[id]) { units[id] = UNITS[id]; continue }
  const g = id === 'CEB' ? G.provinces.CEB : P[id]
  const main = [g.reduce((a, b) => (area([b]) > area([a]) ? b : a))]
  const xs = main[0][0].map((q) => q[0]), ys = main[0][0].map((q) => q[1])
  const target = centers[id] ?? pole(main).point
  let best = null
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 2) {
    if (!contains(main, [x, y])) continue
    const c = Math.min(boundaryDistance(main, [x, y]) - 2, ...labelRects.map((r) => rectDistance([x, y], r) - 2), ...Object.values(centers).map((s) => Math.hypot(x - s[0], y - s[1]) - 10))
    const score = Math.min(c, 15) - Math.hypot(x - target[0], y - target[1]) * 0.03
    if (!best || score > best.score) best = { score, p: [x, y], c }
  }
  units[id] = best.p
  if (best.c < 9) problems.push(`tight unit spot in ${id} (${best.c.toFixed(1)})`)
}
for (const [id, pt] of Object.entries(centers)) if (!contains(P[id], pt)) problems.push(`supply center of ${id} lies outside it`)
if (problems.length) console.warn(`Layout notes:\n  ${problems.join('\n  ')}`)

// --- Board artwork.
const stripes = (g) => `<path d="${geomPath(g)}" style="fill:url(#impassableStripes);fill-rule:evenodd;stroke:#000000;stroke-width:1"/>`
// Small unplayable islets: the same diagonal stripes, finer so they show on a small shape.
const fineStripes = (g) => `<path d="${geomPath(g)}" style="fill:url(#isletStripes);fill-rule:evenodd;stroke:#000000;stroke-width:1"/>`
// Islets are drawn whole over the sea borders (a sea border never runs across an island).
const islandLine = (g) => `<path d="${geomPath(g)}" style="fill:#f4d7b5;stroke:#000000;stroke-width:1;stroke-linejoin:round"/>`
const board = drawBoard({
  width, height, style: { font: true, unzig: false }, defs: classical.defs, provinces: P, isSea, chains,
  islands: ISLANDS, islandMarkup: [...G.islands.filter((i) => !impassable(i)).map((i) => islandLine([i.poly])), ...G.islands.filter(impassable).map((i) => fineStripes([i.poly])), stripes(G.himalaya)],
  centers: Object.values(centers), labels, waterParts: [G.cebuWater],
  crossings: Object.values(G.arrows),
})
const r1 = (n) => Math.round(n * 10) / 10
const layer = (id, body, extra = '') => `<g id="${id}"${extra}>\n${body}\n</g>`
const clipped = (body) => `<g clip-path="url(#board-clip)">\n${body}\n</g>`
const defs = board.defs.replace('</defs>', `<pattern id="isletStripes" patternTransform="rotate(35)" width="5" height="5" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="5" stroke="#000000" stroke-opacity="0.35" stroke-width="2.2"/></pattern><clipPath id="board-clip"><rect width="${width}" height="${height}"/></clipPath></defs>`)
const dsvgId = (id) => id.toLowerCase()
const dsvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
${defs}
${layer('background', clipped(board.background.replace('style="fill:#f4d7b5;stroke:#f4d7b5;stroke-width:0.6"', 'style="fill:#f4d7b5;fill-rule:evenodd;stroke:#f4d7b5;stroke-width:0.6"')))}
${layer('provinces', ids.map((id) => `<path id="${dsvgId(id)}" d="${(board.outlinePath(id) || geomPath(P[id])) + isletsOf(id).map(geomPath).join('')}"/>`).join('\n'), ' style="display:none"')}
${layer('named-coasts', '', ' style="display:none"')}
${layer('unit-positions', Object.entries(units).map(([id, [x, y]]) => `<circle id="${dsvgId(id)}" cx="${r1(x)}" cy="${r1(y)}"/>`).join(''), ' style="display:none"')}
${layer('province-names', board.names)}
<g id="borders"/>
${layer('foreground', clipped(board.foreground))}
</svg>
`
writeFileSync(resolve(root, 'public/maps/era.dsvg'), dsvg)
writeFileSync(resolve(here, 'source/units.json'), JSON.stringify(Object.fromEntries(Object.entries(units).map(([k, v]) => [k, v.map(r1)]))))
console.log(`Built Era of Empire board: ${ids.length} provinces, ${Object.keys(centers).length} supply centers`)

// --- Movement graph, read off the drawn board.
// Two provinces border when they share at least MIN_BORDER units of boundary (a touch at a
// corner is no border). Two coastal provinces are fleet neighbours only where their border
// reaches the sea, so fleets follow the coast (Rangoon–Bangkok is army-only). Straits
// arrows join both armies and fleets.
const MIN_BORDER = 2.5
const nb = Object.fromEntries(ids.map((id) => [id, new Set()]))
for (const [k, len] of lengths) {
  const [a, b] = k.split('|')
  if (len >= MIN_BORDER && nb[a] && nb[b]) { nb[a].add(b); nb[b].add(a) }
}
const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`
const at = new Map()
for (const c of chains) for (const p of [c.points[0], c.points.at(-1)]) {
  const s = at.get(key(p)) ?? at.set(key(p), new Set()).get(key(p)); s.add(c.id); if (c.other) s.add(c.other)
}
const wet = (id) => isSea(id)
const coastal = (id) => !isSea(id) && [...nb[id]].some(wet)
const fleet = Object.fromEntries(ids.map((id) => [id, new Set()]))
for (const a of ids) for (const b of nb[a]) {
  if (isSea(a) || isSea(b)) { if (wet(a) || coastal(a)) if (wet(b) || coastal(b)) fleet[a].add(b); continue }
  const meetsSea = chains.some((c) => c.id === a && c.other === b && [c.points[0], c.points.at(-1)].some((p) => [...(at.get(key(p)) ?? [])].some(wet)))
  if (meetsSea) { fleet[a].add(b); fleet[b].add(a) }
}
for (const k of Object.keys(G.arrows)) {
  const [a, b] = k.split('|')
  for (const g of [nb, fleet]) { g[a].add(b); g[b].add(a) }
}
// Nepal and Punjab meet only at the Himalayas' western corner, as on the published board; the
// rulebook makes only Nepal–Tibet impassable, so that corner is a border.
for (const [a, b] of [['NEP', 'PUN']]) { nb[a].add(b); nb[b].add(a) }
// Impassable: nothing crosses the Himalayas (they separate Nepal and Tibet completely).
if (nb.NEP.has('TIB')) throw new Error('Nepal and Tibet must not border')

// --- Map definition. Powers and setup from the rulebook (start 1870, 22 of 50 centers wins).
const HOMES = {
  britain: ['DEL', 'MAD', 'BOM', 'ADE'], china: ['PEK', 'SHA', 'SIN'], france: ['TON', 'ANN', 'COC'],
  japan: ['TOK', 'KYU', 'KYO'], netherlands: ['BOR', 'JAV', 'SUM'], russia: ['MOS', 'IRK', 'VLA', 'ODE'], turkey: ['ANG', 'BAG', 'CON'],
}
const START = 'A DEL F MAD A BOM F ADE A PEK F SHA A SIN A TON F ANN A COC A TOK F KYU F KYO A BOR F JAV F SUM A MOS A IRK F VLA F ODE A ANG F BAG F CON'.match(/[AF] \w+/g)
// Colours: the classical palette where a power carries over; China, Japan and the
// Netherlands take the board's own yellow, a green and the board's orange.
const POWERS = [
  ['britain', 'Britain', '#4b85fe'], ['china', 'China', '#f5af20'], ['france', 'France', '#00bdd5'], ['japan', 'Japan', '#4aa961'],
  ['netherlands', 'Netherlands', '#e9802f'], ['russia', 'Russia', '#9975fa'], ['turkey', 'Turkey', '#f0574e'],
]
const homeOf = Object.fromEntries(Object.entries(HOMES).flatMap(([p, ps]) => ps.map((id) => [id, p])))
const territories = {}
for (const id of [...ids].sort()) {
  const type = isSea(id) ? 'sea' : coastal(id) ? 'coast' : 'land'
  territories[id] = {
    name: G.names[id], type, supplyCenter: !!centers[id], ...(homeOf[id] ? { homePower: homeOf[id] } : {}),
    adjacent: [...nb[id]].sort(),
    ...(type === 'coast' ? { fleetAdjacent: [...fleet[id]].sort() } : {}),
    render: { center: units[id].map(r1) },
  }
}
for (const u of START) {
  const [t, id] = u.split(' ')
  if (t === 'F' && territories[id].type === 'land') throw new Error(`fleet starts inland in ${id}`)
  if (!centers[id] || !homeOf[id]) throw new Error(`starting unit ${u} is not on a home center`)
}
const map = {
  id: 'era', name: 'Era of Empire', description: 'Diplomacy: Era of Empire — Asia, 1870', playerCount: 7,
  startingYear: 1870, victoryCenters: 22,
  powers: POWERS.map(([id, name, color]) => ({ id, name, color })),
  territories,
  startingUnits: START.map((u) => { const [t, id] = u.split(' '); return { type: t === 'A' ? 'army' : 'fleet', power: homeOf[id], territory: id } }),
}
writeFileSync(resolve(root, 'src/lib/maps/era.ts'), `import type { MapDefinition } from '../mapDefinition'\n\n// Generated by tools/variants/era/build.mjs. Do not edit by hand.\nexport const mapEra: MapDefinition = ${JSON.stringify(map, null, 2)}\n`)
console.log(`Wrote map definition: ${Object.values(territories).filter((t) => t.type === 'sea').length} seas, ${Object.values(territories).filter((t) => t.type !== 'sea').length} land`)
