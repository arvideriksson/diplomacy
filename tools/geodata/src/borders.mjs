// Auto-generate 1900 province borders on real geodata:
//   1. place a seed per province (affine fit jDip -> geodata, see seeds.mjs),
//   2. Voronoi-partition the region by nearest seed,
//   3. clip land/coast cells to the real land, sea cells to the real sea,
//   4. emit one tiled polygon per province (real coastlines + Voronoi interior borders).
// The province COUNT and ADJACENCY follow 1900; interior border *lines* are approximate
// (Voronoi), to be refined. Cross-checks adjacency against the jDip graph.
import { readFileSync, writeFileSync } from 'node:fs'
import { geoMercator, geoPath } from 'd3-geo'
import { Delaunay } from 'd3-delaunay'
import polygonClipping from 'polygon-clipping'
import { map1900 } from '../../../src/lib/maps/1900.ts'

const here = new URL('.', import.meta.url)
const land = JSON.parse(readFileSync(new URL('land.geojson', here), 'utf8'))

const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
const corners = { type: 'MultiPoint', coordinates: [
  [REGION.lonMin, REGION.latMin], [REGION.lonMax, REGION.latMin],
  [REGION.lonMax, REGION.latMax], [REGION.lonMin, REGION.latMax]] }
const W = 1522
const proj = geoMercator()
proj.fitWidth(W, corners)
const H = Math.ceil(geoPath(proj).bounds(corners)[1][1])

// ── affine fit jDip -> geodata px (from known city lon/lat) ──
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
const pairs = Object.entries(REF).map(([id, ll]) => ({ j: map1900.territories[id].render.center, g: proj(ll) })).filter((p) => p.g)
const rows = pairs.map((p) => [p.j[0], p.j[1], 1])
const ax = solve3(rows, pairs.map((p) => p.g[0]))
const ay = solve3(rows, pairs.map((p) => p.g[1]))
const toGeo = ([x, y]) => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]]

// ── seeds (in province order) ──
const ids = Object.keys(map1900.territories)
const seeds = ids.map((id) => toGeo(map1900.territories[id].render.center))
const isSea = ids.map((id) => map1900.territories[id].type === 'sea')

// ── land + sea geometry for clipping ──
const inRegion = (f) => {
  // keep features with any vertex near the region
  const pad = 8
  const test = (c) => c[0] >= REGION.lonMin - pad && c[0] <= REGION.lonMax + pad && c[1] >= REGION.latMin - pad && c[1] <= REGION.latMax + pad
  const walk = (a) => Array.isArray(a[0]) ? a.some(walk) : test(a)
  return walk(f.geometry.coordinates)
}
const projRing = (ring) => ring.map((c) => proj(c)).filter((p) => p && isFinite(p[0]) && isFinite(p[1]))
const toMP = (f) => f.geometry.type === 'Polygon'
  ? [f.geometry.coordinates.map(projRing)]
  : f.geometry.coordinates.map((poly) => poly.map(projRing))
let landMP = []
for (const f of land.features) if (inRegion(f)) landMP = landMP.length ? polygonClipping.union(landMP, toMP(f)) : toMP(f)
const regionRect = [[[[0, 0], [W, 0], [W, H], [0, H], [0, 0]]]]
const seaMP = polygonClipping.difference(regionRect, landMP)
console.log(`land multipolygon: ${landMP.length} parts`)

// ── Voronoi, clipped per province ──
const delaunay = Delaunay.from(seeds)
const voronoi = delaunay.voronoi([0, 0, W, H])
const provincePolys = {} // id -> MultiPolygon
ids.forEach((id, i) => {
  const cell = voronoi.cellPolygon(i)
  if (!cell) return
  const clip = isSea[i] ? seaMP : landMP
  try {
    const inter = polygonClipping.intersection([cell], clip)
    if (inter.length) provincePolys[id] = inter
  } catch (e) { console.warn('clip failed', id, e.message) }
})
console.log(`provinces with geometry: ${Object.keys(provincePolys).length}/${ids.length}`)

// ── adjacency cross-check (Delaunay neighbours vs jDip graph) ──
const jdipPairs = new Set()
for (const id of ids) for (const n of map1900.territories[id].adjacent) jdipPairs.add([id, n].sort().join('~'))
const voroPairs = new Set()
ids.forEach((id, i) => { for (const n of delaunay.neighbors(i)) voroPairs.add([id, ids[n]].sort().join('~')) })
const inBoth = [...jdipPairs].filter((p) => voroPairs.has(p)).length
console.log(`adjacency: jDip ${jdipPairs.size} pairs, Voronoi ${voroPairs.size}; matched ${inBoth} (${(100 * inBoth / jdipPairs.size).toFixed(0)}% of jDip edges)`)

// ── render ──
const LAND = '#d4d0ad', SEA = '#cbc5a0', BORDER = '#4a4636'
const ring2d = (r) => `M ${r.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')} Z`
const mp2d = (mp) => mp.map((poly) => poly.map(ring2d).join(' ')).join(' ')
const paths = ids.filter((id) => provincePolys[id]).map((id) => {
  const fill = map1900.territories[id].type === 'sea' ? SEA : LAND
  return `<path d="${mp2d(provincePolys[id])}" fill="${fill}" stroke="${BORDER}" stroke-width="1" stroke-linejoin="round"/>`
})
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${SEA}"/>
  ${paths.join('\n  ')}
</svg>`
writeFileSync('/tmp/geo-borders.svg', svg)
console.log(`wrote /tmp/geo-borders.svg`)
