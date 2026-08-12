// Generate the editor's selectable cells as the PLANAR OVERLAY of the two datasets, so every
// distinct region is independently selectable:
//   • A "inside base" cells  = admin-1 ∩ a 1900-iterative polity (split by empire border).
//   • C "geodata-extra" cells = the part of an admin-1 unit that lies OUTSIDE the painted base
//     (coastal fringe / small islands the empire/land data drops as sea) — tagged out:1.
// Because A and C are separate cells, you can include the geodata overhang in a province or not.
// Each cell is one CONNECTED component (multipolygons split) so a selection is never disjoint.
//
//   node --experimental-strip-types tools/map-editor/build-units.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import pc from 'polygon-clipping'
import { W, H, isGreenland, inReg, clipProject } from '../geodata/src/projection.mjs'
import { EMPIRE_COLOR, buildLandMask, buildPolities, mp2path, nameOf } from '../geodata/src/basemap.mjs'

const geo = (f) => JSON.parse(readFileSync(new URL(`../geodata/src/${f}`, import.meta.url), 'utf8'))
const admin = geo('admin1.geojson')
const hist = geo('hist1900.geojson')
const land = geo('land.geojson')

const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2) }
// A point GUARANTEED inside the ring (midpoint of the widest interior horizontal segment over a
// few scanlines). The plain vertex-average lands outside concave cells (fjords, C-shaped coasts),
// which breaks lasso selection — this doesn't.
const interiorPoint = (r) => {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
  for (const p of r) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0] }
  let best = null, bestLen = -1
  for (let k = 1; k < 9; k++) {
    const y = minY + ((maxY - minY) * k) / 9
    const xs = []
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const yi = r[i][1], yj = r[j][1]
      if ((yi > y) !== (yj > y)) xs.push(r[i][0] + ((r[j][0] - r[i][0]) * (y - yi)) / (yj - yi))
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) { const len = xs[i + 1] - xs[i]; if (len > bestLen) { bestLen = len; best = [(xs[i] + xs[i + 1]) / 2, y] } }
  }
  return best || [(minX + maxX) / 2, (minY + maxY) / 2]
}
const bboxMP = (mp) => { let b = [1e9, 1e9, -1e9, -1e9]; for (const poly of mp) for (const r of poly) for (const p of r) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1] } return b }
const overlap = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1])

const mask = buildLandMask(land)
// base polities = exactly the 1900iterative.svg regions, with empire label + bbox
const polities = buildPolities(hist, mask).map((p) => ({ mp: p.mp, name: p.name, empire: EMPIRE_COLOR[p.name] ? p.name : '(none)', bbox: bboxMP(p.mp) }))
// raw great-power empires (coarse, used only to LABEL the geodata-extra coastal cells)
const rawEmpires = hist.features
  .filter((f) => inReg(f) && !isGreenland(f) && EMPIRE_COLOR[nameOf(f)])
  .map((f) => { const mp = clipProject(f); return { mp, empire: nameOf(f), bbox: bboxMP(mp) } })
  .filter((e) => e.mp.length)
// admin-1 units (finer real land)
const units = admin.features
  .filter((f) => inReg(f) && !isGreenland(f))
  .map((f) => { const mp = clipProject(f); return { mp, bbox: bboxMP(mp), name: f.properties.name || f.properties.name_local || '?', country: f.properties.admin || '?' } })
  .filter((u) => u.mp.length)

const cells = []
const emit = (mp, empire, name, country, out) => {
  // Inside-base cells use a tiny threshold so no painted base land falls through the cracks
  // (a dropped admin∩base piece is still subtracted in the remainder pass → otherwise a gap).
  // Overhang cells keep a larger threshold to avoid sub-pixel clip-sliver clutter.
  const minA = out ? 8 : 1
  for (const poly of mp) { // one cell per CONNECTED component (poly = [outer, ...holes])
    if (ringArea(poly[0]) < minA) continue
    const [cx, cy] = interiorPoint(poly[0])
    cells.push({ id: cells.length, empire, name, country, out: out ? 1 : 0, cx: +cx.toFixed(1), cy: +cy.toFixed(1), d: mp2path([poly]) })
  }
}

// split `region` by `groups` (disjoint, each {mp,bbox,empire}); emit each piece; return the leftover
const splitInto = (region, groups, U, out) => {
  const rbox = bboxMP(region)
  let rem = region
  for (const g of groups) {
    if (!overlap(g.bbox, rbox)) continue
    let piece; try { piece = pc.intersection(region, g.mp) } catch { continue }
    if (!piece.length) continue
    emit(piece, g.empire, U.name, U.country, out)
    try { rem = pc.difference(rem, g.mp) } catch {}
    if (!rem.length) break
  }
  return rem
}

for (const U of units) {
  // A: the part of the admin unit inside the painted base, split by empire/neutral polity
  const leftover = splitInto(U.mp, polities, U, false)
  // C: admin land outside the painted base (geodata-extra) — label by raw empire where possible
  if (leftover && leftover.length) {
    const rem2 = splitInto(leftover, rawEmpires, U, true)
    if (rem2 && rem2.length) emit(rem2, '(none)', U.name, U.country, true)
  }
}

// A-remainder: painted base land NOT covered by any admin-1 unit (where the coarse land mask
// bulges beyond admin-1). These are empire-COLOURED areas with no admin cell — the user can see
// the colour but couldn't select it. Keep them selectable, inside-base (transparent).
for (const P of polities) {
  let rem = P.mp
  const bbox = bboxMP(rem)
  for (const U of units) {
    if (!overlap(U.bbox, bbox)) continue
    try { rem = pc.difference(rem, U.mp) } catch {}
    if (!rem.length) break
  }
  if (rem.length) emit(rem, P.empire, P.name, P.name, false)
}

// B: empire territory that lies OUTSIDE our land mask (inside the empire borders, "sea" to the
// geodata) — coastal strips + small empire islands. Subtract admin so it doesn't double the
// C cells; what remains is empire-only overhang. Tagged out:1 so it shows + is selectable.
for (const f of hist.features) {
  if (!inReg(f) || isGreenland(f)) continue
  let b; try { b = pc.difference(clipProject(f), mask) } catch { b = [] }
  if (!b.length) continue
  let bbox = bboxMP(b)
  for (const U of units) {
    if (!overlap(U.bbox, bbox)) continue
    try { b = pc.difference(b, U.mp) } catch {}
    if (!b.length) break
    bbox = bboxMP(b)
  }
  if (b.length) emit(b, EMPIRE_COLOR[nameOf(f)] ? nameOf(f) : '(none)', nameOf(f), nameOf(f), true)
}

const nOut = cells.filter((c) => c.out).length
console.log(`cells: ${cells.length} (${nOut} extra: geodata-beyond-empire + empire-beyond-land)`)

writeFileSync(new URL('./units.json', import.meta.url), JSON.stringify({ W, H, empireColor: EMPIRE_COLOR, cells }))
console.log('wrote tools/map-editor/units.json (base layer = 1900iterative.svg, linked directly)')
