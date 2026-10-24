/** Rebuild the 1900 board and map definition from the classical board and the variant data.
 * Run: node tools/variants/1900/build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readClassical } from './lib/classical.mjs'
import { europe, extendSouth, fillSlivers, finalTouches, RENAMES, PLAYABLE_ISLANDS, KATTEGAT_LINES } from './edits.mjs'
import { audit } from './lib/audit.mjs'
import { drawBoard, geomPath, label, coastMark, offBoardNote } from './artwork.mjs'
import { intersect, subtract, union, poly, contains, pole, area, boundaryDistance } from './lib/geom.mjs'
import { LabelPlacer, labelBox } from './lib/labels.mjs'
import { BOLD_NAMES, DROP_LABELS, DROP_COAST_MARKS, LABELS, COAST_MARKS, CENTERS, UNITS, CROSSING_ARROWS, RED_SEA_NOTE, MOROCCO_NOTE, LONG_ROUTE } from './layout.mjs'

const HEIGHT = 1620
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const src = (name) => readFileSync(resolve(root, 'tools/variants/1900/source', name), 'utf8')
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const xml = src('1900_adjacency.xml')
const rules = src('variants.xml')
const provinces = [...xml.matchAll(/<PROVINCE\s+([^>]+)>([\s\S]*?)<\/PROVINCE>/g)].map((m) => {
  const { shortname, fullname } = attrs(m[1])
  const edges = Object.fromEntries([...m[2].matchAll(/<ADJACENCY\s+([^>]+)\/>/g)].map((e) => {
    const { type, refs } = attrs(e[1]); return [type ?? 'mv', refs.split(/\s+/).filter(Boolean)]
  }))
  return { id: shortname, name: fullname, edges }
})
const supply = Object.fromEntries([...rules.matchAll(/<SUPPLYCENTER\s+([^>]+)\/>/g)].map((m) => {
  const a = attrs(m[1]); return [a.province, a]
}))
const starts = [...rules.matchAll(/<INITIALSTATE\s+([^>]+)\/>/g)].map((m) => attrs(m[1]))
const startingYear = Number(attrs(rules.match(/<STARTINGTIME\s+([^>]+)\/>/)?.[1] ?? '').turn?.match(/\d{4}/)?.[0])
const victoryCenters = Number(attrs(rules.match(/<WINNING_SUPPLY_CENTERS\s+([^>]+)\/>/)?.[1] ?? '').value)
if (!Number.isInteger(startingYear) || !Number.isInteger(victoryCenters) || victoryCenters < 1) {
  throw new Error('Invalid starting year or victory target in variants.xml')
}
const sourceIds = new Set(provinces.map((p) => p.id))
// The source adjacency XML uses judge aliases for these two sea provinces.
const sourceAliases = { mao: 'mid', nao: 'nat' }
for (const p of provinces) for (const ref of Object.values(p.edges).flat()) {
  const target = ref.split('-')[0]
  if (!sourceIds.has(sourceAliases[target] ?? target)) throw new Error(`Unknown adjacency ${p.id} -> ${ref}`)
}
for (const s of starts) if (!sourceIds.has(s.province)) throw new Error(`Unknown starting province ${s.province}`)

// --- Geometry: the classical partition, edited into the 1900 provinces. ---
const classical = readClassical(readFileSync(resolve(root, 'public/maps/classical.dsvg'), 'utf8'))
const { width } = classical
const { provinces: edited, gibraltarStrait } = europe(classical)
const { provinces: P, project } = extendSouth(edited, classical, HEIGHT)
const islands = [], islandMarkup = []
classical.islands.forEach((g, i) => { if (!Object.values(PLAYABLE_ISLANDS).some((pt) => contains(g, pt))) { islands.push(g); islandMarkup.push(classical.islandMarkup[i]) } })
// Water left between provinces stays drawn as lakes, except the strip at the head of the
// Red Sea, which is part of it (and so of the Mid-Atlantic, which the Red Sea belongs to here).
// The strip's very tip touches Palestine, which the Red Sea does not border; that tip is Sinai.
// Canals are narrow water through land, drawn like the classical Kiel canal: classical
// leaves Kiel's as water outside every province (kept here, not filled in as a sliver), and
// the Suez Canal (Port Said, Ismailia, Suez) is cut through Egypt the same way.
const kielCanal = union(...subtract(poly([[612, 655], [672, 655], [672, 690], [612, 690]]), ...Object.values(P), ...islands).filter((pl) => area([pl]) > 20))
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
const suezCanal = intersect(channel(extend([[32.3, 31.26], [32.28, 30.6], [32.55, 29.97]].map(project), 12), 3), P.egy)
P.egy = subtract(P.egy, suezCanal)
const leftover = union(fillSlivers(P, [...islands, kielCanal, suezCanal], width, HEIGHT), kielCanal, suezCanal)
const redSeaHead = intersect(union(...leftover.filter((pl) => pl[0].every(([x, y]) => x > 1300 && y > 1450))), poly([[1300, 1504], [1400, 1504], [1400, 1600], [1300, 1600]]))
const sinaiTip = subtract(union(...leftover.filter((pl) => pl[0].every(([x, y]) => x > 1300 && y > 1450))), redSeaHead)
P.mid = union(P.mid, redSeaHead); P.egy = union(P.egy, sinaiTip)
// As on the original 1900 board, Hejaz reaches well north of the Gulf of Aqaba and meets Sinai,
// so Palestine stays clear of the Red Sea.
const aqabaHead = intersect(P.pal, poly([[1300, 1530], [1300, 1482], [1318, 1483], [1331, 1481], [1340, 1478], [1349, 1479], [1358, 1477], [1367, 1475], [1376, 1476], [1386, 1472], [1420, 1470], [1420, 1530]]))
P.pal = subtract(P.pal, aqabaHead); P.hej = union(P.hej, aqabaHead)
const lakes = subtract(leftover, redSeaHead, sinaiTip)
finalTouches(P)
// Drop zero-width remnants of merged borders, and hairline holes inside land
// provinces where source regions did not quite meet (seas keep their island holes).
const isSeaId = (id) => !provinces.find((p) => p.id === id)?.edges.mv?.length
for (const id of Object.keys(P)) P[id] = P[id].filter((p) => area([p]) > 1).map((p) => [p[0], ...p.slice(1).filter((h) => area([[h]]) > (isSeaId(id) ? 1 : 60))])

// Remove zero-width spikes: a vertex where the ring goes out and comes straight back.
const despike = (ring) => {
  const r = ring.slice()
  for (let pass = 0; pass < 4; pass++) for (let i = 0; i < r.length && r.length > 4; i++) {
    const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length]
    if (Math.hypot(a[0] - c[0], a[1] - c[1]) < 0.3 && Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.5) { r.splice(i, 1); i-- }
  }
  return r
}
for (const id of Object.keys(P)) P[id] = P[id].map((p) => p.map(despike))
// Small stray pieces of a land province join the neighbour they share most border with.
for (const id of Object.keys(P)) {
  if (isSeaId(id) || id === 'gib' || P[id].length < 2) continue
  const pieces = P[id].slice().sort((a, b) => area([b]) - area([a]))
  for (const piece of pieces.slice(1)) {
    if (area([piece]) > 800) continue
    const touch = (o) => piece[0].filter((p) => boundaryDistance(P[o], p) < 0.6).length
    const best = Object.keys(P).filter((o) => o !== id && !isSeaId(o)).reduce((a, b) => (touch(b) > touch(a) ? b : a))
    if (!touch(best)) continue
    P[id] = subtract(P[id], [piece]); P[best] = union(P[best], [piece])
  }
}
// A sliver of the Atlantic is left between Morocco's coast and the board's west edge; it is Morocco.
{
  const notch = intersect(P.mid, poly([[-1, 1335], [20, 1335], [20, 1400], [-1, 1400]]))
  if (notch.length) { P.mid = subtract(P.mid, notch); P.mor = union(P.mor, notch) }
}
const visible = provinces.filter((p) => p.id !== 'dum')
for (const p of visible) if (!P[p.id]?.length) throw new Error(`No geometry for ${p.id}`)
for (const id of Object.keys(P)) if (!sourceIds.has(id)) throw new Error(`Leftover classical province ${id}`)
const isSea = (id) => !provinces.find((p) => p.id === id)?.edges.mv?.length
const { problems, warnings, chains } = audit(P, provinces, { frame: [0, 0, width, HEIGHT], holes: [...islands, lakes] })
for (const w of warnings) console.warn(`warning: ${w}`)
if (problems.length) (process.env.AUDIT_DRAFT ? console.warn : (m) => { throw new Error(m) })(`Board does not match the 1900 movement graph:\n  ${problems.join('\n  ')}`)

// --- Supply centers, unit anchors and labels. ---
const inside = (id, pt) => contains(P[id], pt)
const sourceOf = Object.fromEntries(Object.entries(RENAMES).map(([c, n]) => [n, c]))
const centers = {}
for (const pt of classical.centers) {
  const id = Object.keys(P).find((k) => inside(k, pt))
  if (id && supply[id] && !CENTERS[id]) centers[id] = pt
}
Object.assign(centers, Object.fromEntries(Object.entries(CENTERS).map(([id, c]) => [id, c === 'pole' ? pole(P[id]).point : c])))
for (const id of Object.keys(supply)) if (id !== 'dum' && !centers[id]) throw new Error(`No supply center position for ${id}`)


const units = {}, layoutProblems = []
for (const p of visible) {
  const classicalPoint = classical.units[sourceOf[p.id] ?? p.id]
  units[p.id] = UNITS[p.id] ?? (classicalPoint && inside(p.id, classicalPoint) ? classicalPoint : pole(P[p.id]).point)
  if (!inside(p.id, units[p.id])) layoutProblems.push(`unit anchor of ${p.id} lies outside it`)
}

// Named coasts: classical click areas where they still apply, otherwise a split of the province.
// Spain's three coasts are divided by sweeping curves.
const bezier = (a, b, c, d, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t
  return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k])
})
const coastAreas = {
  'stp/nc': intersect(classical.namedCoasts['stp/nc'], P.stp), 'stp/sc': intersect(classical.namedCoasts['stp/sc'], P.stp),
  'spa/nc': intersect(P.spa, poly([[60, 900], [60, 1082], ...bezier([120, 1082], [200, 1086], [290, 1060], [362, 1014]), [362, 900]])),
  'spa/wc': intersect(subtract(P.spa, poly([[60, 900], [60, 1082], ...bezier([120, 1082], [200, 1086], [290, 1060], [362, 1014]), [362, 900]])), poly([[0, 1100], ...bezier([60, 1100], [150, 1100], [178, 1140], [178, 1300]), [0, 1300]])),
  'mac/wc': intersect(P.mac, poly([[800, 1000], [905, 1000], [905, 1300], [800, 1300]])),
  'mac/ec': subtract(P.mac, poly([[800, 1000], [905, 1000], [905, 1300], [800, 1300]])),
}
coastAreas['spa/ec'] = subtract(P.spa, coastAreas['spa/nc'], coastAreas['spa/wc'])
for (const [id, g] of Object.entries(coastAreas)) {
  units[id] ??= UNITS[id] ?? classical.units[id] ?? pole(g).point
  if (!inside(id.split('/')[0], units[id])) layoutProblems.push(`coast anchor ${id} lies outside its province`)
}

const near = (a, b, d = 25) => Math.hypot(a[0] - b[0], a[1] - b[1]) < d
const kept = classical.labels.filter((l) => !DROP_LABELS.has(l.text) && !DROP_COAST_MARKS.some(([t, at]) => t === l.text && near(l.at, at)))
// Classical upright names follow the same bold rule as the new ones (coast marks stay bold).
const COAST_TEXT = new Set(['NC', 'SC', 'EC', 'WC'])
const reweight = (l) => {
  if (/font-style:italic/.test(l.markup) || COAST_TEXT.has(l.text)) return l.markup
  const w = BOLD_NAMES.has(l.text) ? 'bold' : 'normal'
  return l.markup.replace(/font-weight:\w+/g, `font-weight:${w}`).replace(/font-weight="\w+"/g, `font-weight="${w}"`)
}
const labels = kept.map(reweight)
// New labels are placed automatically inside their province, clear of borders,
// supply centers, coast marks and the classical labels that are kept.
const placer = new LabelPlacer()
for (const c of Object.values(centers)) placer.blockCircle(c, 12)
// Every label's box, so unit anchors can be kept clear of them afterwards.
const labelRects = []
const rect = (at, w, h, angle) => labelRects.push({ at, w, h, angle })
for (const l of kept) {
  const w = labelBox({ text: l.text, size: l.size, kind: 'sc' }).w
  placer.blockLabel(l.at, w, l.size * 0.8, l.angle); rect(l.at, w, l.size * 0.8, l.angle)
}
for (const m of COAST_MARKS) placer.blockLabel(m.at, 22, 10, m.angle)
const labelArea = (id) => P[id]
for (const [id, hint] of Object.entries(LABELS).sort(([a], [b]) => area(labelArea(a)) - area(labelArea(b)))) {
  const l = { size: 16, ...hint }
  // `fixed` labels keep their hand position (they may overlap their supply center).
  const spot = l.fixed ? (placer.blockLabel(l.at, labelBox(l).w, l.size * 0.8, l.angle), { at: l.at, angle: l.angle, size: l.size }) : (l.free ? new LabelPlacer() : placer).place(labelArea(id), l, pole(labelArea(id)).point)
  if (!spot) layoutProblems.push(`no room for the ${l.text} label`)
  if (process.env.LABEL_DEBUG) console.log(id, spot && { at: spot.at, angle: spot.angle, size: spot.size })
  labels.push(label({ ...(spot ? { ...l, ...spot } : { ...l, at: l.at ?? pole(P[id]).point }), bold: BOLD_NAMES.has(l.text) }))
  if (spot) rect(spot.at, labelBox({ ...l, size: spot.size }).w, spot.size * 0.8, spot.angle)
}
for (const m of COAST_MARKS) rect(m.at, 22, 10, m.angle)

// Unit anchors in new or relabelled provinces stay clear of labels and supply
// centers: a unit token has radius 11, so look for the most open spot inside the
// province that keeps the token off every label box and bullseye.
const rectDistance = (p, { at, w, h, angle }) => {
  const a = -angle * Math.PI / 180, dx = p[0] - at[0], dy = p[1] - at[1]
  const u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.hypot(Math.max(0, Math.abs(u) - w / 2), Math.max(0, Math.abs(v) - h / 2))
}
const clearance = (p, id) => Math.min(
  boundaryDistance(P[id], p),
  ...labelRects.map((r) => rectDistance(p, r) - 2),
  ...Object.values(centers).map((c) => Math.hypot(p[0] - c[0], p[1] - c[1]) - 10),
)
// Relabelled provinces need a fully clear spot; every other province (classical
// anchors) moves only when its unit would sit right on a label or bullseye.
for (const id of visible.map((p) => p.id)) {
  if (clearance(units[id], id) >= (LABELS[id] ? 12 : 4)) continue
  // Search the province's main piece only (not, say, Sicily for Naples).
  const main = [P[id].reduce((a, b) => (area([b]) > area([a]) ? b : a))]
  const pts = main[0][0], xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
  let best = null
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 2) {
    if (!contains(main, [x, y])) continue
    const c = Math.min(clearance([x, y], id), 16) - Math.hypot(x - units[id][0], y - units[id][1]) * 0.02
    if (!best || c > best.c) best = { c, p: [x, y] }
  }
  if (best) units[id] = best.p
  if (LABELS[id] && (!best || clearance(units[id], id) < 10)) layoutProblems.push(`no clear unit spot in ${id}`)
  if (process.env.LABEL_DEBUG) console.log('moved unit', id, units[id].map(Math.round), clearance(units[id], id).toFixed(1))
}
for (const m of COAST_MARKS) labels.push(coastMark(m))
let longRoutes
// Notes for routes that leave the board, laid along a line fitted to the shore: the Red Sea's
// centre line (midpoints between its shores) and the line of Morocco's Atlantic coast.
{
  const crossings = (g, axis, v) => g.flatMap((pl) => pl.flatMap((r) => r.flatMap((a, i) => {
    const b = r[(i + 1) % r.length], o = 1 - axis
    return (a[axis] > v) !== (b[axis] > v) ? [a[o] + (v - a[axis]) * (b[o] - a[o]) / (b[axis] - a[axis])] : []
  }))).sort((p, q) => p - q)
  // Least-squares line through points: its centroid and unit direction.
  const fit = (pts) => {
    const n = pts.length, c = [0, 1].map((k) => pts.reduce((s, p) => s + p[k], 0) / n)
    const sxx = pts.reduce((s, p) => s + (p[0] - c[0]) ** 2, 0), syy = pts.reduce((s, p) => s + (p[1] - c[1]) ** 2, 0), sxy = pts.reduce((s, p) => s + (p[0] - c[0]) * (p[1] - c[1]), 0)
    const t = Math.atan2(2 * sxy, sxx - syy) / 2
    return { c, dir: [Math.cos(t), Math.sin(t)] }
  }
  const place = ({ text, textAt, arrow, offset = 0, tilt = 0 }, { c, dir }, heading) => {
    // `heading` picks which way the arrow points; the text always reads left to right.
    // `tilt` turns the note clockwise from the fitted line, in degrees.
    const f = dir[0] * heading[0] + dir[1] * heading[1] < 0 ? [-dir[0], -dir[1]] : dir, k = tilt * Math.PI / 180
    const d = [f[0] * Math.cos(k) - f[1] * Math.sin(k), f[0] * Math.sin(k) + f[1] * Math.cos(k)]
    const normal = [-d[1], d[0]], at = (t) => [c[0] + d[0] * t + normal[0] * offset, c[1] + d[1] * t + normal[1] * offset]
    const read = d[0] < 0 ? [-d[0], -d[1]] : d
    labels.push(offBoardNote({ text, at: at(textAt), angle: Math.atan2(read[1], read[0]) * 180 / Math.PI, arrow: [at(arrow[0]), at(arrow[1])] }))
  }
  const red = []
  for (let y = RED_SEA_NOTE.span[0]; y <= RED_SEA_NOTE.span[1]; y += 2) { const xs = crossings(P.mid, 1, y).filter((x) => x > RED_SEA_NOTE.from); if (xs.length >= 2) red.push([(xs[0] + xs[1]) / 2, y]) }
  const redLine = fit(red), coast = []
  place(RED_SEA_NOTE, redLine, [0, 1])
  for (let x = MOROCCO_NOTE.span[0]; x <= MOROCCO_NOTE.span[1]; x += 2) { const ys = crossings(P.mor, 0, x); if (ys.length) coast.push([x, ys[0]]) }
  const coastLine = fit(coast)
  place(MOROCCO_NOTE, coastLine, [-1, 1])
  // The long route's two legs: down the Red Sea's centre line and off the bottom edge, then in
  // from the west edge, `LONG_ROUTE.fromBottom` of the way up the Mid-Atlantic's stretch of it.
  const down = redLine.dir[1] < 0 ? [-redLine.dir[0], -redLine.dir[1]] : redLine.dir
  const redExit = [redLine.c[0] + down[0] * (HEIGHT + 12 - redLine.c[1]) / down[1], HEIGHT + 12]
  const edge = P.mid.flatMap((pl) => pl[0]).filter(([x]) => x < 0.5).map(([, y]) => y)
  const westY = Math.max(...edge) - LONG_ROUTE.fromBottom * (Math.max(...edge) - Math.min(...edge))
  // It starts well off the board on the line through that edge point and the Mid-Atlantic's
  // unit, so the arrow comes in straight.
  const westEdge = [0, westY], toward = [units.mid[0] - westEdge[0], units.mid[1] - westEdge[1]], len = Math.hypot(...toward)
  const westEntry = [westEdge[0] - toward[0] / len * LONG_ROUTE.offBoard, westEdge[1] - toward[1] / len * LONG_ROUTE.offBoard]
  // Egypt joins the Red Sea's centre line first; Hejaz, already at the bottom edge, heads straight off.
  longRoutes = { egy: [[redLine.c, redExit], [westEntry, westEdge]], hej: [[redExit], [westEntry, westEdge]] }
}

for (const [id, pt] of Object.entries(centers)) if (!inside(id, pt)) layoutProblems.push(`supply center of ${id} lies outside it`)
if (layoutProblems.length) (process.env.LAYOUT_DRAFT ? console.warn : (m) => { throw new Error(m) })(`Layout problems:\n  ${layoutProblems.join('\n  ')}`)

// --- dSVG output. Province ids follow the app's dSVG naming. ---
const outId = (id) => ({ nws: 'nrg' }[id] ?? id)
// Finishing: embedded label font; no frame or compass rose on the board.
const style = { font: true }
const board = drawBoard({ width, height: HEIGHT, style, defs: classical.defs, provinces: P, isSea, chains, islands, islandMarkup, centers: Object.values(centers), labels, waterParts: [gibraltarStrait], crossings: CROSSING_ARROWS, extraSeaBorders: KATTEGAT_LINES.map((id) => classical.seaBorders[id]) })
const r1 = (n) => Math.round(n * 10) / 10
const layer = (id, body, extra = '') => `<g id="${id}"${extra}>\n${body}\n</g>`
// The coast shading and water-lining reach past the board edge; clip the artwork to the board.
const clipped = (body) => `<g clip-path="url(#board-clip)">\n${body}\n</g>`
const defs = board.defs.replace('</defs>', `<clipPath id="board-clip"><rect width="${width}" height="${HEIGHT}"/></clipPath></defs>`)
const dsvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${HEIGHT}" width="100%" height="100%">
${defs}
${layer('background', clipped(board.background))}
${layer('provinces', visible.map((p) => `<path id="${outId(p.id)}" d="${board.outlinePath(p.id) || geomPath(P[p.id])}"/>`).join('\n'), ' style="display:none"')}
${layer('named-coasts', Object.entries(coastAreas).map(([id, g]) => `<path id="${outId(id.split('/')[0])}/${id.split('/')[1]}" d="${geomPath(g)}"/>`).join('\n'), ' style="display:none"')}
${layer('unit-positions', Object.entries(units).map(([id, [x, y]]) => `<circle id="${id.includes('/') ? outId(id.split('/')[0]) + '/' + id.split('/')[1] : outId(id)}" cx="${r1(x)}" cy="${r1(y)}"/>`).join(''), ' style="display:none"')}
${layer('province-names', board.names)}
${layer('routes', [
  // Suez rule 2: moves between Egypt/Hejaz and the Mid-Atlantic go around Africa. Their
  // arrows leave the board down the Red Sea and come back in off Morocco (one subpath each).
  ['egy~mid', longRoutes.egy], ['hej~mid', longRoutes.hej],
].map(([id, legs]) => `<path id="${id}" d="${legs.map((leg) => 'M' + leg.map((p) => p.map(r1).join(' ')).join('L')).join('')}"/>`).join(''), ' style="display:none"')}
<g id="borders"/>
${layer('foreground', clipped(board.foreground))}
</svg>
`
writeFileSync(resolve(root, 'public/maps/1900.dsvg'), dsvg)

// --- Map definition. ---
const toGame = (id) => ({ nws: 'NWG', nwy: 'NOR', nat: 'NAO', mid: 'MAO' }[id] ?? id.toUpperCase())
const normalize = (refs) => [...new Set((refs ?? []).map((r) => toGame(sourceAliases[r.split('-')[0]] ?? r.split('-')[0])))]
const powerColors = { britain: '#4b85fe', france: '#00bdd5', germany: '#8c929f', italy: '#4aa961', austria: '#f0574e', russia: '#9975fa', turkey: '#f5af20' }
const round = (p) => p.map(r1)
const territories = {}
for (const p of provinces) {
  const { id, edges } = p, sc = supply[id], xc = normalize(edges.xc)
  // DUM is jDip's stand-in for the Russian Emergency Measures rule, which the engine implements directly.
  if (id === 'dum') continue
  const coasts = {}
  for (const c of ['nc', 'sc', 'ec', 'wc']) if (edges[c]?.length) coasts[c] = { name: { nc: 'North Coast', sc: 'South Coast', ec: 'East Coast', wc: 'West Coast' }[c], fleetAdjacency: normalize(edges[c]), render: { center: round(units[`${id}/${c}`]) } }
  const sea = id !== 'dum' && !edges.mv?.length
  territories[toGame(id)] = {
    name: p.name, type: sea ? 'sea' : (xc.length || Object.keys(coasts).length ? 'coast' : 'land'), supplyCenter: !!sc,
    ...(sc?.homepower && sc.homepower !== 'none' ? { homePower: sc.homepower } : {}),
    adjacent: normalize(Object.values(edges).flat()),
    ...(!sea && xc.length && !Object.keys(coasts).length ? { fleetAdjacent: xc } : {}),
    ...(Object.keys(coasts).length ? { coasts } : {}),
    render: { center: units[id] ? round(units[id]) : [-100, -100] },
  }
}
const map = {
  id: '1900', name: '1900', startingYear, victoryCenters,
  initialOwnership: Object.fromEntries(Object.entries(supply).filter(([id, s]) => id !== 'dum' && s.owner && s.owner !== 'none').map(([id, s]) => [toGame(id), s.owner])),
  description: 'Diplomacy 1900 — Europe, North Africa and the Near East', playerCount: 7,
  powers: Object.entries(powerColors).map(([id, color]) => ({ id, name: { britain: 'Britain', austria: 'Austria-Hungary' }[id] ?? id[0].toUpperCase() + id.slice(1), color })),
  territories,
  // The 1900 variant rules (vDiplomacy), beyond what the adjacency data expresses.
  rules: {
    longRoutes: [['EGY', 'MAO'], ['HEJ', 'MAO']],
    convoyCoasts: ['GIB'],
    disorderHomes: { britain: ['EGY'], france: ['ALG'] },
    emergency: { nation: 'russia', buildSite: 'SIB' },
    strictVictory: true,
  },
  startingUnits: starts.map((s) => ({ type: s.unit, power: s.power, territory: toGame(s.province), ...(s.unitcoast ? { coast: s.unitcoast } : {}) })),
}
writeFileSync(resolve(root, 'src/lib/maps/1900.ts'), `import type { MapDefinition } from '../mapDefinition'\n\n// Generated by tools/variants/1900/build.mjs. Do not edit by hand.\nexport const map1900: MapDefinition = ${JSON.stringify(map, null, 2)}\n`)
console.log(`Built 1900: ${provinces.length} territories, ${starts.length} starting units`)
