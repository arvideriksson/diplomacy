// Province borders from REAL granular geodata (Natural Earth admin-1 states/provinces):
//   1. seed per province (affine jDip -> geodata),
//   2. assign each admin-1 unit to its nearest LAND province seed,
//   3. dissolve (union) admin units per province  -> land provinces with REAL borders
//      (rivers, historical admin lines) + real coastlines,
//   4. sea zones: Voronoi cells clipped to the sea (no admin data offshore).
// Cross-checks adjacency vs the jDip graph.
import { readFileSync, writeFileSync } from 'node:fs'
import { geoMercator, geoPath } from 'd3-geo'
import { Delaunay } from 'd3-delaunay'
import pc from 'polygon-clipping'
import { map1900 } from '../../../src/lib/maps/1900.ts'

const here = new URL('.', import.meta.url)
const land = JSON.parse(readFileSync(new URL('land.geojson', here), 'utf8'))
const admin = JSON.parse(readFileSync(new URL('admin1.geojson', here), 'utf8'))

// ── projection (same as prototype) ──
const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
const corners = { type: 'MultiPoint', coordinates: [
  [REGION.lonMin, REGION.latMin], [REGION.lonMax, REGION.latMin],
  [REGION.lonMax, REGION.latMax], [REGION.lonMin, REGION.latMax]] }
const W = 1522
const proj = geoMercator()
proj.fitWidth(W, corners)
const H = Math.ceil(geoPath(proj).bounds(corners)[1][1])

// ── affine fit jDip -> geodata px ──
const REF = {
  LON: [-0.13, 51.5], PAR: [2.35, 48.85], BER: [13.4, 52.5], ROM: [12.5, 41.9],
  MOS: [37.6, 55.75], CON: [28.98, 41.0], MAR: [5.37, 43.3], STP: [30.3, 59.9],
  EDI: [-3.2, 55.95], SEV: [33.5, 44.6], NAP: [14.25, 40.85], ANK: [32.85, 39.9],
  WAR: [21.0, 52.2], SPA: [-3.7, 40.4], SWE: [16.0, 59.3], MOR: [-6.0, 32.0],
}
const solve3 = (rows, target) => {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0]
  rows.forEach((r, i) => { for (let a = 0; a < 3; a++) { v[a] += r[a] * target[i]; for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b] } })
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]; [v[c], v[p]] = [v[p], v[c]]
    for (let r = 0; r < 3; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = 0; k < 3; k++) M[r][k] -= f * M[c][k]; v[r] -= f * v[c] }
  }
  return [v[0] / M[0][0], v[1] / M[1][1], v[2] / M[2][2]]
}
const pairs = Object.entries(REF).map(([id, ll]) => ({ j: map1900.territories[id].render.center, g: proj(ll) }))
const rows = pairs.map((p) => [p.j[0], p.j[1], 1])
const ax = solve3(rows, pairs.map((p) => p.g[0]))
const ay = solve3(rows, pairs.map((p) => p.g[1]))
const toGeo = ([x, y]) => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]]

const ids = Object.keys(map1900.territories)
const seeds = ids.map((id) => toGeo(map1900.territories[id].render.center))
const isSea = ids.map((id) => map1900.territories[id].type === 'sea')
const landSeedIdx = ids.map((_, i) => i).filter((i) => !isSea[i])

// ── geometry helpers ──
const projRing = (ring) => ring.map((c) => proj(c)).filter((p) => p && isFinite(p[0]) && isFinite(p[1]))
const featMP = (f) => f.geometry.type === 'Polygon'
  ? [f.geometry.coordinates.map(projRing)]
  : f.geometry.coordinates.map((poly) => poly.map(projRing))
const centroidPx = (f) => {
  let sx = 0, sy = 0, n = 0
  const walk = (a) => { if (typeof a[0] === 'number') { const p = proj(a); if (p) { sx += p[0]; sy += p[1]; n++ } } else a.forEach(walk) }
  walk(f.geometry.coordinates)
  return n ? [sx / n, sy / n] : null
}
const inRegion = (f) => {
  const pad = 6, t = (c) => c[0] >= REGION.lonMin - pad && c[0] <= REGION.lonMax + pad && c[1] >= REGION.latMin - pad && c[1] <= REGION.latMax + pad
  const walk = (a) => (typeof a[0] === 'number') ? t(a) : a.some(walk)
  return walk(f.geometry.coordinates)
}

// ── 1) assign admin units to nearest LAND province seed; dissolve per province ──
const byProvince = {} // id -> accumulated MultiPolygon
let assigned = 0
for (const f of admin.features) {
  if (!inRegion(f)) continue
  const c = centroidPx(f)
  if (!c) continue
  let best = -1, bd = Infinity
  for (const i of landSeedIdx) { const dx = seeds[i][0] - c[0], dy = seeds[i][1] - c[1], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i } }
  const id = ids[best]
  let mp
  try { mp = featMP(f) } catch { continue }
  byProvince[id] = byProvince[id] ? pc.union(byProvince[id], mp) : mp
  assigned++
}
console.log(`assigned ${assigned} admin units to ${Object.keys(byProvince).length} land provinces`)

// ── 2) sea provinces: Voronoi clipped to the sea (region minus land) ──
let landMask = []
for (const f of land.features) if (inRegion(f)) landMask = landMask.length ? pc.union(landMask, featMP(f)) : featMP(f)
const regionRect = [[[[0, 0], [W, 0], [W, H], [0, H], [0, 0]]]]
const seaMP = pc.difference(regionRect, landMask)
const voronoi = Delaunay.from(seeds).voronoi([0, 0, W, H])
ids.forEach((id, i) => {
  if (!isSea[i]) return
  const cell = voronoi.cellPolygon(i)
  if (!cell) return
  try { const inter = pc.intersection([cell], seaMP); if (inter.length) byProvince[id] = inter } catch {}
})

// fallback: land/coast provinces that got no admin units -> Voronoi cell clipped to land
ids.forEach((id, i) => {
  if (isSea[i] || byProvince[id]) return
  const cell = voronoi.cellPolygon(i)
  if (!cell) return
  try { const inter = pc.intersection([cell], landMask); if (inter.length) byProvince[id] = inter } catch {}
})
console.log(`provinces with geometry: ${Object.keys(byProvince).length}/${ids.length}`)

// ── adjacency cross-check (shared-border in geometry vs jDip graph) ──
const jdip = new Set()
for (const id of ids) for (const n of map1900.territories[id].adjacent) jdip.add([id, n].sort().join('~'))
const vor = new Set()
const di = Delaunay.from(seeds)
ids.forEach((id, i) => { for (const n of di.neighbors(i)) vor.add([id, ids[n]].sort().join('~')) })
const matched = [...jdip].filter((p) => vor.has(p)).length
console.log(`adjacency (seed-Delaunay proxy): ${matched}/${jdip.size} jDip edges (${(100 * matched / jdip.size).toFixed(0)}%)`)

// ── render ──
const LAND = '#d4d0ad', SEA = '#cbc5a0', BORDER = '#4a4636'
const ring2d = (r) => `M ${r.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')} Z`
const mp2d = (mp) => mp.map((poly) => poly.map(ring2d).join(' ')).join(' ')
const paths = ids.filter((id) => byProvince[id]).map((id) =>
  `<path d="${mp2d(byProvince[id])}" fill="${map1900.territories[id].type === 'sea' ? SEA : LAND}" stroke="${BORDER}" stroke-width="1" stroke-linejoin="round"/>`)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${SEA}"/>
  ${paths.join('\n  ')}
</svg>`
writeFileSync('/tmp/geo-admin.svg', svg)
console.log('wrote /tmp/geo-admin.svg')
