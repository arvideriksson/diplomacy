// Step 1 of border generation: place each 1900 province's seed point onto the geodata.
// jDip's render centres are in jDip's own projection; we fit an affine map from jDip
// coords -> geodata pixels using a handful of provinces whose real lon/lat we know, then
// transform every province centre. This script renders the seeds as dots so we can
// eyeball whether they land in the right place before partitioning.
import { readFileSync, writeFileSync } from 'node:fs'
import { geoMercator, geoPath } from 'd3-geo'
import { map1900 } from '../../../src/lib/maps/1900.ts'

const here = new URL('.', import.meta.url)
const land = JSON.parse(readFileSync(new URL('land.geojson', here), 'utf8'))

// ── same projection as the prototype ──
const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
const corners = {
  type: 'MultiPoint',
  coordinates: [
    [REGION.lonMin, REGION.latMin], [REGION.lonMax, REGION.latMin],
    [REGION.lonMax, REGION.latMax], [REGION.lonMin, REGION.latMax],
  ],
}
const W = 1522
const proj = geoMercator()
proj.fitWidth(W, corners)
const H = Math.ceil(geoPath(proj).bounds(corners)[1][1])
proj.clipExtent([[0, 0], [W, H]])
const path = geoPath(proj)

// ── reference provinces: real lon/lat of their city ──
const REF = {
  LON: [-0.13, 51.5], PAR: [2.35, 48.85], BER: [13.4, 52.5], ROM: [12.5, 41.9],
  MOS: [37.6, 55.75], CON: [28.98, 41.0], MAR: [5.37, 43.3], STP: [30.3, 59.9],
  EDI: [-3.2, 55.95], SEV: [33.5, 44.6], NAP: [14.25, 40.85], ANK: [32.85, 39.9],
  WAR: [21.0, 52.2], SPA: [-3.7, 40.4], SWE: [16.0, 59.3], MOR: [-6.0, 32.0],
}

// ── least-squares affine fit  jDip(x,y) -> geo(px) ──
// Solve for [a b c; d e f] minimizing || A·[jx jy 1]ᵀ - geo ||.
const pairs = []
for (const [id, lonlat] of Object.entries(REF)) {
  const t = map1900.territories[id]
  if (!t) continue
  const [gx, gy] = proj(lonlat)
  pairs.push({ j: t.render.center, g: [gx, gy] })
}
// Normal equations for x: minimize over (a,b,c) of a*jx+b*jy+c ≈ gx (and same for y).
const solve3 = (rows, target) => {
  // rows: [jx, jy, 1]; build 3x3 normal matrix M and rhs v
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const v = [0, 0, 0]
  rows.forEach((r, i) => {
    for (let a = 0; a < 3; a++) {
      v[a] += r[a] * target[i]
      for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]
    }
  })
  // Gaussian elimination (3x3)
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    ;[v[c], v[p]] = [v[p], v[c]]
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = 0; k < 3; k++) M[r][k] -= f * M[c][k]
      v[r] -= f * v[c]
    }
  }
  return [v[0] / M[0][0], v[1] / M[1][1], v[2] / M[2][2]]
}
const rows = pairs.map((p) => [p.j[0], p.j[1], 1])
const ax = solve3(rows, pairs.map((p) => p.g[0]))
const ay = solve3(rows, pairs.map((p) => p.g[1]))
const toGeo = ([jx, jy]) => [ax[0] * jx + ax[1] * jy + ax[2], ay[0] * jx + ay[1] * jy + ay[2]]

// residuals
let maxres = 0
for (const p of pairs) {
  const [gx, gy] = toGeo(p.j)
  maxres = Math.max(maxres, Math.hypot(gx - p.g[0], gy - p.g[1]))
}
console.log(`affine fit over ${pairs.length} refs, max residual ${maxres.toFixed(1)}px`)

// ── seeds for every province ──
const seeds = Object.entries(map1900.territories).map(([id, t]) => ({
  id, type: t.type, xy: toGeo(t.render.center),
}))

const LAND = '#d4d0ad', SEA = '#cbc5a0'
const landPaths = land.features.map((f) => path(f)).filter(Boolean)
const dots = seeds.map((s) => {
  const color = s.type === 'sea' ? '#1f6f9f' : '#b03030'
  return `<circle cx="${s.xy[0].toFixed(1)}" cy="${s.xy[1].toFixed(1)}" r="4" fill="${color}"/>` +
    `<text x="${(s.xy[0] + 5).toFixed(1)}" y="${(s.xy[1] + 3).toFixed(1)}" font-size="9" fill="#222">${s.id}</text>`
})
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${SEA}"/>
  <g fill="${LAND}" stroke="rgba(0,0,0,0.5)" stroke-width="1">${landPaths.map((d) => `<path d="${d}"/>`).join('')}</g>
  <g>${dots.join('')}</g>
</svg>`
writeFileSync('/tmp/geo-seeds.svg', svg)
console.log(`wrote /tmp/geo-seeds.svg — ${seeds.length} province seeds`)
