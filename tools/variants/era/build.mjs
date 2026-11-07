/** Build the Era of Empire board (public/maps/era.dsvg) in the classical board's style.
 * Run: npm run map:era
 *
 * The province partition comes from source/geometry.json, traced from the published board
 * (see README.md, "Tracing"). The drawing reuses the 1900 board's artwork, so all three boards
 * share one look: parchment land and sea, blurred coast shadow with water-lining, 1px land
 * borders, dashed sea borders, supply-center points and Libre Baskerville labels; hand placements
 * from the layout editor (/editor) come from placements.json.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readClassical } from '../1900/lib/classical.mjs'
import { sharedEdges } from '../1900/lib/edges.mjs'
import { drawBoard, geomPath, label } from '../1900/artwork.mjs'
import { union, intersect, subtract, poly, contains, pole, area, boundaryDistance, channel, extendEnds, rectDistance, largestPiece, bestGridPoint, despikeReversals } from '../lib/geom.mjs'
import { root, writeBoard, writeMapDefinition, readPlacements, checkPlacements, failUnlessDraft } from '../lib/board.mjs'
import { Placer, textBox } from '../lib/labels.mjs'
import { LABELS, BOLD_NAMES, UNITS, IMPASSABLE_ISLETS, CENTER_AT, CEBU_WATER, LAND_PATCHES, WATER_PATCHES } from './layout.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const G = JSON.parse(readFileSync(resolve(here, 'source/geometry.json'), 'utf8'))
const { width, height } = G
const SEA = new Set(G.sea)
const ids = Object.keys(G.provinces)

// Province geometry. Cebu is islands inside a ring of water that belongs to the province (drawn
// as sea, its edge a dashed sea border, like 1900's Strait of Gibraltar).
// Specks among Cebu's islands (a few square units, traced from the board's print) are water.
const cebuSpecks = G.provinces.CEB.filter((pl) => area([pl]) < 50)
G.provinces.CEB = G.provinces.CEB.filter((pl) => area([pl]) >= 50)
const P = { ...G.provinces }
P.CEB = union(P.CEB, G.cebuWater, cebuSpecks)
// The Suez Canal is cut through Egypt as narrow water, as on the 1900 board; Egypt stays one
// province on both banks.
const suezCanal = intersect(channel(extendEnds(G.suez, 14), 3), P.EGY)
P.EGY = subtract(P.EGY, suezCanal)
// The Himalayas are impassable land: filled as land, bordered, striped, never a province.
const HIM = '~him'
P[HIM] = G.himalaya
const isSea = (id) => SEA.has(id)

// Cebu's ring is traced from pixels, so its edge against the open sea is jagged: smooth it
// there (the stretches along Manila's and Davao's coasts stay as they are). Water the smooth
// edge takes in comes from the sea beside it; water it leaves goes back to that sea.
{
  for (const pts of CEBU_WATER) for (const id of ['MPO', 'LPO']) {
    const handWater = intersect(P[id], poly(pts))
    P[id] = subtract(P[id], handWater); P.CEB = union(P.CEB, handWater)
  }
  const ring = largestPiece(P.CEB)[0]
  const pts = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2))
    for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
  }
  const [x0, y0, x1, y1] = [Math.min(...pts.map((p) => p[0])) - 5, Math.min(...pts.map((p) => p[1])) - 5, Math.max(...pts.map((p) => p[0])) + 5, Math.max(...pts.map((p) => p[1])) + 5]
  const near = ids.filter((id) => id !== 'CEB' && P[id].some((pl) => pl[0].some(([x, y]) => x > x0 && x < x1 && y > y0 && y < y1)))
  // What lies beside each point of the ring: a sea's id, or null (land).
  const side = pts.map((p) => { let best = null, bd = 1.5; for (const id of near) { const d = boundaryDistance(P[id], p); if (d < bd) { bd = d; best = id } } return best && isSea(best) ? best : null })
  const n = pts.length, sigma = 9, taper = 12
  // Distance (in points) to the nearest land point, so the smoothing fades out towards the coasts.
  const toLand = pts.map((_, i) => { for (let k = 0; k < n / 2; k++) if (!side[(i + k) % n] || !side[(i - k + n) % n]) return k; return n })
  const smooth = pts.map((p, i) => {
    if (!side[i]) return p
    let sx = 0, sy = 0, sw = 0
    for (let k = -3 * sigma; k <= 3 * sigma; k++) { const q = pts[(i + k + n) % n], w = Math.exp(-k * k / (2 * sigma * sigma)); sx += q[0] * w; sy += q[1] * w; sw += w }
    const t = Math.min(1, toLand[i] / taper)
    return [p[0] + (sx / sw - p[0]) * t, p[1] + (sy / sw - p[1]) * t]
  })
  const R = poly(smooth)
  for (const id of near.filter(isSea)) { const taken = intersect(P[id], R); if (taken.length) { P[id] = subtract(P[id], R); P.CEB = union(P.CEB, taken) } }
  // Where two seas meet on the ring, the border between them carries straight on to the
  // smooth edge: a half-plane on the first sea's side of that border's last stretch.
  const cuts = []
  for (let i = 0; i < n; i++) {
    const a = side[i], b = side[(i + 1) % n]
    if (!a || !b || a === b) continue
    const J = pts[i], border = P[a].flatMap((pl) => pl.flat()).filter((v) => boundaryDistance(P[b], v) < 0.3 && Math.hypot(v[0] - J[0], v[1] - J[1]) < 40)
    const F = border.reduce((f, v) => (Math.hypot(v[0] - J[0], v[1] - J[1]) > Math.hypot(f[0] - J[0], f[1] - J[1]) ? v : f), J)
    const d = [J[0] - F[0], J[1] - F[1]], len = Math.hypot(...d)
    if (len < 3) continue
    const u = [d[0] / len, d[1] / len], nrm = [-u[1], u[0]], q = pts[(i - 3 + n) % n]
    const s = Math.sign((q[0] - J[0]) * nrm[0] + (q[1] - J[1]) * nrm[1]) || 1, far = 500
    const at = (t, k) => [F[0] + u[0] * t + nrm[0] * s * k, F[1] + u[1] * t + nrm[1] * s * k]
    cuts.push({ J, a, b, H: poly([at(-far, 0), at(far, 0), at(far, far), at(-far, far)]) })
  }
  // Water now outside the ring goes to the sea beside it.
  for (const piece of subtract(P.CEB, R)) {
    const cut = cuts.find(({ J }) => piece[0].some((v) => Math.hypot(v[0] - J[0], v[1] - J[1]) < 30))
    const parts = cut ? [[cut.a, intersect([piece], cut.H)], [cut.b, subtract([piece], cut.H)]] : [[null, [piece]]]
    for (const [to, g] of parts) for (const pc of g) {
      let sea = to
      if (!sea) {
        const p = [pc[0].reduce((s, q) => s + q[0], 0) / pc[0].length, pc[0].reduce((s, q) => s + q[1], 0) / pc[0].length]
        let bd = Infinity
        pts.forEach((q, i) => { const dd = Math.hypot(q[0] - p[0], q[1] - p[1]); if (side[i] && dd < bd) { bd = dd; sea = side[i] } })
      }
      if (sea) { P[sea] = union(P[sea], [pc]); P.CEB = subtract(P.CEB, [pc]) }
    }
  }
  // Bits of sea walled in between the ring and Manila's or Davao's coast are Cebu's water.
  for (const id of near.filter(isSea)) {
    const main = largestPiece(P[id])
    for (const pc of P[id]) if (pc !== main && area([pc]) < 400) { P.CEB = union(P.CEB, [pc]); P[id] = P[id].filter((x) => x !== pc) }
  }
}
// A small detached piece of a sea (a tracing sliver along another sea's coast) belongs to
// the sea it touches most.
for (const id of ids.filter(isSea)) {
  if (P[id].length < 2) continue
  const main = largestPiece(P[id])
  for (const pc of P[id]) {
    if (pc === main || area([pc]) >= 200) continue
    let to = null, most = 0
    for (const o of ids.filter((o) => o !== id && isSea(o))) { const n = pc[0].filter((v) => boundaryDistance(P[o], v) < 0.3).length; if (n > most) { most = n; to = o } }
    if (to) { P[to] = union(P[to], [pc]); P[id] = P[id].filter((x) => x !== pc) }
  }
}
// Specks of land cut off from their province (a few square units) go to what surrounds them.
for (const id of ids.filter((x) => !isSea(x))) {
  if (P[id].length < 2) continue
  const main = largestPiece(P[id])
  for (const pc of P[id]) {
    if (pc === main || area([pc]) >= 6) continue
    let to = null, most = 0
    for (const o of ids.filter((o) => o !== id)) { const n = pc[0].filter((v) => boundaryDistance(P[o], v) < 0.3).length; if (n > most) { most = n; to = o } }
    if (to) { P[to] = union(P[to], [pc]); P[id] = P[id].filter((x) => x !== pc) }
  }
}
// Polygon operations can leave zero-width spikes (a ring running out to a point and straight
// back) and zero-area holes, which draw as doubled lines and stubs: drop any vertex where the
// ring reverses on itself, and any hole without area (despikeReversals in lib/geom.mjs).
for (const id of ids) P[id] = despikeReversals(P[id])
// Borders between two seas are traced from pixels and jagged: smooth each one, keeping its two
// ends where they are, and split the two seas again along the smooth line.
{
  const key = ([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`
  const sigma = 5, step = 1.5
  const smoothRun = (run) => {
    const pts = [run[0]]
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
      for (let k = 1; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
    }
    const n = pts.length, s = sigma / step, E0 = pts[0], E1 = pts[n - 1]
    // Beyond each end the line is mirrored through that end, so the smooth line keeps its ends.
    const at = (i) => (i < 0 ? [2 * E0[0] - pts[-i][0], 2 * E0[1] - pts[-i][1]] : i >= n ? [2 * E1[0] - pts[2 * n - 2 - i][0], 2 * E1[1] - pts[2 * n - 2 - i][1]] : pts[i])
    return pts.map((p, i) => {
      if (i === 0 || i === n - 1) return p
      let sx = 0, sy = 0, sw = 0
      for (let k = -Math.ceil(3 * s); k <= Math.ceil(3 * s); k++) { const j = Math.max(-(n - 1), Math.min(2 * n - 2, i + k)), q = at(j), w = Math.exp(-k * k / (2 * s * s)); sx += q[0] * w; sy += q[1] * w; sw += w }
      return [sx / sw, sy / sw]
    })
  }
  const seas = ids.filter(isSea)
  for (const a of seas) for (const b of seas) {
    if (a >= b) continue
    const bKeys = new Set(P[b].flatMap((pl) => pl.flat()).map(key))
    const mainA = largestPiece(P[a]), ring = mainA[0]
    const on = ring.map((v) => bKeys.has(key(v)))
    if (on.filter(Boolean).length < 3 || on.every(Boolean)) continue
    // Runs of the ring along b, starting the walk just after a point not on b.
    const start = on.findIndex((x) => !x), n = ring.length, out = []
    let run = []
    const flush = () => { if (run.length >= 3) out.push(...smoothRun(run)); else out.push(...run); run = [] }
    for (let k = 1; k <= n; k++) {
      const v = ring[(start + k) % n]
      if (on[(start + k) % n]) run.push(v)
      else { flush(); out.push(v) }
    }
    flush()
    const U = union(P[a], P[b]), A = intersect(U, [[out, ...mainA.slice(1)]])
    const newA = union(A, ...P[a].filter((pl) => pl !== mainA).map((pl) => [pl]))
    P[b] = subtract(U, newA); P[a] = newA
  }
}

const classical = readClassical(readFileSync(resolve(root, 'public/maps/classical.dsvg'), 'utf8'))
// Islets: each belongs to a province (it is shaded and clickable with it) but stays out of the
// movement graph, which is read from the provinces' main shapes only.
const centroid = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]
const impassable = (i) => { const [x, y] = centroid(i.poly[0]); return IMPASSABLE_ISLETS.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1) }
// Islets are solid: drop interior rings (outline artefacts traced as holes).
for (const i of G.islands) i.poly = [i.poly[0]]
// An islet touching its own province is part of it (else both coasts are drawn, doubled).
G.islands = G.islands.filter((i) => {
  if (!P[i.owner] || !i.poly[0].some((p) => boundaryDistance(P[i.owner], p) < 0.3)) return true
  P[i.owner] = union(P[i.owner], [i.poly]); return false
})
for (const { owner, poly: pts } of LAND_PATCHES) {
  const patch = poly(pts)
  for (const id of ids) if (isSea(id) || id === 'CEB') { const t = intersect(id === 'CEB' ? subtract(P.CEB, G.provinces.CEB) : P[id], patch); if (t.length) { P[id] = subtract(P[id], patch); P[owner] = union(P[owner], t) } }
  G.islands = G.islands.filter((i) => { if (!intersect([i.poly], patch).length) return true; P[i.owner] = union(P[i.owner], [i.poly]); return false })
  P[owner] = union(P[owner], intersect(patch, subtract(patch, ...ids.map((id) => P[id]))))
}
for (const { from, to, poly: pts } of WATER_PATCHES) { const t = intersect(P[from], poly(pts)); P[from] = subtract(P[from], poly(pts)); P[to] = union(P[to], t) }
for (const id of ids) P[id] = despikeReversals(P[id])
// The ring's water (Cebu's islands inside it), once the geometry is final.
const cebuWater = subtract(P.CEB, G.provinces.CEB)
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
// Hand placements from the layout editor (/editor), keyed by dSVG id (lower case): unit
// anchors, supply centers and labels. They win over everything computed here.
const PLACEMENTS = readPlacements(here)
const fromDsvg = (d) => d.toUpperCase()
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
const dsvgId = (id) => id.toLowerCase()
// Unknown ids throw; a pinned unit outside its province fails the build unless LAYOUT_DRAFT is set.
failUnlessDraft(checkPlacements(PLACEMENTS, { units: ids.map(dsvgId), centers: Object.keys(centers).map(dsvgId), labels: ids.map((id) => `name:${dsvgId(id)}`) }, (d, pt) => contains(P[fromDsvg(d)], pt)), 'Layout problems', 'LAYOUT_DRAFT')
for (const [d, pt] of Object.entries(PLACEMENTS.centers)) centers[fromDsvg(d)] = pt
const placer = new Placer()
for (const c of Object.values(centers)) placer.blockCircle(c, 13)
// Strait arrows: labels keep clear of them.
for (const [a, b] of Object.values(G.arrows)) placer.blockLine(a, b, 5)
const neighbours = (id) => [...lengths].filter(([k, len]) => len >= 2.5 && k.split('|').includes(id)).map(([k]) => k.split('|').find((x) => x !== id))
const mainPiece = (g) => [largestPiece(g)]
const notOwnIslets = (id) => G.islands.filter((i) => i.owner !== id).map((i) => [i.poly])
const problems = [], placed = {}
const landOrder = ids.filter((id) => !isSea(id)).sort((a, b) => area(P[a]) - area(P[b]))
const seaOrder = ids.filter(isSea).sort((a, b) => area(P[a]) - area(P[b]))
// Ratio of the long to the short axis of a ring's vertices.
const elongation = (ring) => {
  const n = ring.length, mx = ring.reduce((s, q) => s + q[0], 0) / n, my = ring.reduce((s, q) => s + q[1], 0) / n
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of ring) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
  const h = Math.hypot((sxx - syy) / 2, sxy), m = (sxx + syy) / 2
  return Math.sqrt((m + h) / Math.max(m - h, 1e-6))
}
const optsCache = {}
const optsOf = (id) => optsCache[id] ??= (() => {
  const hint = LABELS[id] ?? {}, kind = isSea(id) ? 'sea' : centers[id] ? 'sc' : 'land', name = hint.text ?? G.names[id]
  const main = mainPiece(id === 'CEB' ? G.provinces.CEB : P[id]), scale = Math.sqrt(area(main))
  // The visual centre: deep inside the shape, pulled towards its centroid (a plain pole of
  // inaccessibility drifts into whichever lobe happens to be widest).
  const ring = main[0][0], c = [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length]
  // Only large or elongated provinces need the pull; a small compact one's pole is its centre.
  const pull = scale >= 165 || elongation(ring) > 1.8
  const target = pole(main, pull ? (p) => 1 / (1 + Math.hypot(p[0] - c[0], p[1] - c[1]) / (0.35 * scale)) : undefined).point
  return { name, kind, bold: BOLD_NAMES.has(G.names[id]), size: isSea(id) ? 16 : 17, minSize: isSea(id) ? 11 : 9, margin: isSea(id) ? 6 : 3, target, scale, ...hint }
})()
const placeFixed = (id, o) => { const b = textBox({ text: o.name, size: o.size, kind: o.kind, bold: o.bold }); placer.blockRect(o.at, b.w, b.h, o.angle ?? 0); placed[id] = { text: o.name, at: o.at, angle: o.angle ?? 0, size: o.size, ...b } }
// 1. Land names inside their provinces, smallest provinces first.
for (const id of landOrder) {
  const o = optsOf(id)
  if (o.fixed) { placeFixed(id, o); continue }
  // Cebu's name goes in the water of its ring, clear of the islands.
  const region = id === 'CEB' ? subtract(cebuWater, G.provinces.CEB, ...ISLANDS) : P[id]
  if (o.spill !== 'first') placed[id] = placer.place(region, o)
}
// A land name in the water beside its province, on one line (step 2).
const spill = (id) => {
  const o = optsOf(id), cur = placed[id]
  if (cur) placer.unblock(cur.blocked)
  let alt = null
  for (const sea of neighbours(id).filter(isSea)) {
    const trial = new Placer(); trial.blocked = placer.blocked.slice()
    // 'across': the name may lie across the coast, partly in the province and partly at sea.
    const r = trial.place(subtract(o.across ? union(P[id], P[sea]) : P[sea], ...ISLANDS), { ...o, size: Math.min(o.size, 13), minSize: 10, margin: 4, scale: o.scale / 2.5, within: o.within ?? o.scale * 0.6 + 50, texts: [o.name], angles: o.angles ?? [0, -5, 5, -10, 10, -15, 15] })
    if (r && (!alt || r.score > alt.score)) alt = r
  }
  if (alt && (!cur || alt.size >= cur.size + 2)) placed[id] = alt
  if (placed[id]) placed[id].blocked = placer.blockRect(placed[id].at, placed[id].w, placed[id].h, placed[id].angle)
}
// Names that must go in the water (spill: 'first') do so even when they would fit inside.
for (const id of landOrder) if (optsOf(id).spill === 'first') { placed[id] = null; spill(id) }
// 2. A land name that only fits small (or not at all) goes in the water beside its province,
// before the sea names (a sea has room to give way).
for (const id of landOrder) {
  const o = optsOf(id), cur = placed[id]
  if (o.fixed || o.spill === false || o.spill === 'first' || (cur && cur.size >= 11)) continue
  spill(id)
}
// 3. Sea names.
for (const id of seaOrder) {
  const o = optsOf(id)
  if (o.fixed) { placeFixed(id, o); continue }
  placed[id] = placer.place(subtract(P[id], ...notOwnIslets(id)), o)
}
const labels = [], labelRects = []
for (const id of ids) {
  const s = placed[id]
  if (!s) { problems.push(`no room for the ${G.names[id]} label`); continue }
  const o = optsOf(id), lid = `name:${id.toLowerCase()}`, pin = PLACEMENTS.labels[lid]
  const at = pin?.at ?? s.at, angle = pin ? pin.angle ?? s.angle : s.angle
  labels.push(label({ id: lid, text: s.text, at, angle, size: s.size, kind: o.kind, bold: o.bold }))
  labelRects.push({ at, w: s.w, h: s.h, angle })
}

// --- Unit anchors: the most open spot of each province's largest piece, clear of its label
// and supply center (a unit token has radius 11).
const units = {}
for (const id of ids) {
  const pin = PLACEMENTS.units[id.toLowerCase()]
  if (pin || UNITS[id]) { units[id] = pin ?? UNITS[id]; continue }
  const g = id === 'CEB' ? G.provinces.CEB : P[id]
  const main = [largestPiece(g)]
  const target = centers[id] ?? pole(main).point
  const clearance = ([x, y]) => Math.min(boundaryDistance(main, [x, y]) - 2, ...labelRects.map((r) => rectDistance([x, y], r) - 2), ...Object.values(centers).map((s) => Math.hypot(x - s[0], y - s[1]) - 10))
  const best = bestGridPoint(main[0], (p) => Math.min(clearance(p), 15) - Math.hypot(p[0] - target[0], p[1] - target[1]) * 0.03)
  units[id] = best.p
  const c = clearance(best.p)
  if (c < 9) problems.push(`tight unit spot in ${id} (${c.toFixed(1)})`)
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
  labels, waterParts: [cebuWater],
  crossings: Object.values(G.arrows),
})
writeBoard('era', {
  width, height, board, centers, centerId: dsvgId,
  background: board.background.replace('style="fill:#f4d7b5;stroke:#f4d7b5;stroke-width:0.6"', 'style="fill:#f4d7b5;fill-rule:evenodd;stroke:#f4d7b5;stroke-width:0.6"'),
  extraDefs: '<pattern id="isletStripes" patternTransform="rotate(35)" width="5" height="5" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="5" stroke="#000000" stroke-opacity="0.35" stroke-width="2.2"/></pattern>',
  provinces: ids.map((id) => [dsvgId(id), (board.outlinePath(id) || geomPath(P[id])) + isletsOf(id).map(geomPath).join('')]),
  units: Object.entries(units).map(([id, pt]) => [dsvgId(id), pt]),
})
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
// Flag asset keys (src/lib/flags.ts) for powers that don't fly the one named after them.
const FLAGS = { russia: 'russia-imperial' }
const POWERS = [
  ['britain', 'Britain', '#4b85fe'], ['china', 'China', '#f5af20'], ['france', 'France', '#00bdd5'], ['japan', 'Japan', '#ffffff'],
  ['netherlands', 'Netherlands', '#e9802f'], ['russia', 'Russia', '#8c929f'], ['turkey', 'Turkey', '#f0574e'],
]
const homeOf = Object.fromEntries(Object.entries(HOMES).flatMap(([p, ps]) => ps.map((id) => [id, p])))
const territories = {}
for (const id of [...ids].sort()) {
  const type = isSea(id) ? 'sea' : coastal(id) ? 'coast' : 'land'
  territories[id] = {
    name: G.names[id], type, supplyCenter: !!centers[id], ...(homeOf[id] ? { homePower: homeOf[id] } : {}),
    adjacent: [...nb[id]].sort(),
    ...(type === 'coast' ? { fleetAdjacent: [...fleet[id]].sort() } : {}),
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
  // The rulebook's Winter rules: build in any owned center (conscription), switch a unit's
  // type on a center (conversion); powers tied for the most centers at 22+ share the win.
  rules: { buildAnyCenter: true, conversion: true, sharedVictory: true },
  powers: POWERS.map(([id, name, color]) => ({ id, name, color, ...(FLAGS[id] ? { flag: FLAGS[id] } : {}) })),
  territories,
  startingUnits: START.map((u) => { const [t, id] = u.split(' '); return { type: t === 'A' ? 'army' : 'fleet', power: homeOf[id], territory: id } }),
}
writeMapDefinition('era', 'mapEra', map)
console.log(`Wrote map definition: ${Object.values(territories).filter((t) => t.type === 'sea').length} seas, ${Object.values(territories).filter((t) => t.type !== 'sea').length} land`)
