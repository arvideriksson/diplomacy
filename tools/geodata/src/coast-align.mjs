// Coastline registration: warp jDip -> geodata by aligning their COASTLINES.
//   - jDip coastline  = outline of the union of jDip land provinces (in jDip space),
//   - geodata coastline = Natural Earth land boundary (in geodata px),
//   - start from a sparse city-point TPS, then ICP: warp jDip coast -> snap each point to
//     the nearest geodata coast point -> refit a TPS through those correspondences,
//     repeated. Output: an overlay of (warped jDip coast) vs (geodata coast) to see if
//     they now line up, plus mean coastline distance before/after.
import { readFileSync, writeFileSync } from 'node:fs'
import { geoMercator, geoPath } from 'd3-geo'
import pc from 'polygon-clipping'
import { map1900 } from '../../../src/lib/maps/1900.ts'

const here = new URL('.', import.meta.url)
const landGeo = JSON.parse(readFileSync(new URL('land.geojson', here), 'utf8'))
const dsvg = readFileSync(new URL('../../../public/maps/1900.dsvg', here), 'utf8')

const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
const corners = { type: 'MultiPoint', coordinates: [[REGION.lonMin, REGION.latMin], [REGION.lonMax, REGION.latMin], [REGION.lonMax, REGION.latMax], [REGION.lonMin, REGION.latMax]] }
const W = 1522
const proj = geoMercator()
proj.fitWidth(W, corners)
const H = Math.ceil(geoPath(proj).bounds(corners)[1][1])

// ── TPS machinery ──
const gauss = (A, b) => {
  const n = b.length, M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]; const piv = M[c][c] || 1e-9
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / piv; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  return M.map((r, c) => r[n] / (r[c] || 1e-9))
}
const phi = (r2) => (r2 > 1e-12 ? 0.5 * r2 * Math.log(r2) : 0)
const buildTPS = (s, d, lam) => {
  const n = s.length, m = n + 3, L = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { const dx = s[i][0] - s[j][0], dy = s[i][1] - s[j][1]; L[i][j] = i === j ? lam : phi(dx * dx + dy * dy) }
    L[i][n] = 1; L[i][n + 1] = s[i][0]; L[i][n + 2] = s[i][1]; L[n][i] = 1; L[n + 1][i] = s[i][0]; L[n + 2][i] = s[i][1]; b[i] = d[i]
  }
  const c = gauss(L, b)
  return (p) => { let v = c[n] + c[n + 1] * p[0] + c[n + 2] * p[1]; for (let i = 0; i < n; i++) { const dx = p[0] - s[i][0], dy = p[1] - s[i][1]; v += c[i] * phi(dx * dx + dy * dy) } return v }
}
const makeWarp = (src, dst, lam) => { const fx = buildTPS(src, dst.map((d) => d[0]), lam), fy = buildTPS(src, dst.map((d) => d[1]), lam); return (p) => [fx(p), fy(p)] }

// ── city control points (anchors) ──
const REF = { ICE: [-19, 64.9], EDI: [-3.19, 55.95], LON: [-0.13, 51.5], IRE: [-8, 53.3], NWY: [10.7, 59.9], SWE: [16, 59.3], STP: [30.3, 59.9], PAR: [2.35, 48.85], SPA: [-3.7, 40.4], POR: [-8.2, 39.5], MAR: [5.37, 43.6], BER: [13.4, 52.5], ROM: [12.5, 41.9], NAP: [14.25, 40.85], VIE: [16.37, 48.2], BUD: [19, 47], MOS: [37.6, 55.75], CON: [28.98, 41], ANK: [33, 39.9], SEV: [34.5, 45.5], WAR: [21, 52.2], MOR: [-6.5, 32.5], EGY: [31, 28.5], GRE: [22.5, 39.5], DAM: [37, 34] }
const cityJ = [], cityG = []
for (const [id, ll] of Object.entries(REF)) if (map1900.territories[id]) { cityJ.push(map1900.territories[id].render.center); cityG.push(proj(ll)) }

// ── jDip coastline = outline of the union of land provinces (jDip space) ──
const FLAT = 5
const flatten = (d) => {
  const t = d.match(/[MLCZ]|-?\d*\.?\d+/g) || []; const rings = []; let cur = null, x = 0, y = 0, i = 0, cmd = ''
  const cub = (x1, y1, x2, y2, x3, y3) => { for (let k = 1; k <= FLAT; k++) { const u = 1 - k / FLAT, s = k / FLAT; cur.push([u * u * u * x + 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s * x3, u * u * u * y + 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s * y3]) } x = x3; y = y3 }
  while (i < t.length) { if (/[A-Z]/.test(t[i])) { cmd = t[i++]; if (cmd === 'M') { if (cur?.length) rings.push(cur); cur = []; x = +t[i++]; y = +t[i++]; cur.push([x, y]) } else if (cmd === 'Z') { if (cur?.length) { rings.push(cur); cur = null } } continue } if (cmd === 'L') { x = +t[i++]; y = +t[i++]; cur.push([x, y]) } else if (cmd === 'C') { const a = +t[i++], b2 = +t[i++], c2 = +t[i++], e = +t[i++], f = +t[i++], g = +t[i++]; cub(a, b2, c2, e, f, g) } else i++ }
  if (cur?.length) rings.push(cur); return rings
}
const provLayer = dsvg.match(/<g id="provinces">([\s\S]*?)<\/g>/)[1]
let landUnion = []
for (const m of provLayer.matchAll(/<path id="([a-z/]+)" d="([^"]*)"/g)) {
  const t = map1900.territories[m[1].toUpperCase()]
  if (!t || t.type === 'sea') continue
  const mp = flatten(m[2]).map((r) => [r])
  try { landUnion = landUnion.length ? pc.union(landUnion, mp) : mp } catch {}
}
const sampleRings = (mp, step) => { const out = []; for (const poly of mp) for (const ring of poly) for (let i = 0; i < ring.length; i += step) out.push(ring[i]); return out }
const jCoast = sampleRings(landUnion, 2)
console.log(`jDip coastline: ${jCoast.length} points`)

// ── geodata coastline points (px) + grid index ──
const inReg = (f) => { const pad = 4, t = (c) => c[0] >= REGION.lonMin - pad && c[0] <= REGION.lonMax + pad && c[1] >= REGION.latMin - pad && c[1] <= REGION.latMax + pad; const w = (a) => typeof a[0] === 'number' ? t(a) : a.some(w); return w(f.geometry.coordinates) }
const gCoast = []
for (const f of landGeo.features) { if (!inReg(f)) continue; const w = (a) => { if (typeof a[0] === 'number') { const p = proj(a); if (p && p[0] > -50 && p[0] < W + 50 && p[1] > -50 && p[1] < H + 50) gCoast.push(p) } else a.forEach(w) }; w(f.geometry.coordinates) }
const CELL = 24, grid = new Map(), key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
for (const p of gCoast) { const k = key(p[0], p[1]); (grid.get(k) || grid.set(k, []).get(k)).push(p) }
const nearest = (x, y) => { let best = null, bd = Infinity; const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const arr = grid.get(`${cx + i},${cy + j}`); if (!arr) continue; for (const p of arr) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = p } } } return best ? { p: best, d: Math.sqrt(bd) } : null }
console.log(`geodata coastline: ${gCoast.length} points`)

const meanDist = (warp) => { let s = 0, n = 0; for (const jp of jCoast) { const w = warp(jp), nr = nearest(w[0], w[1]); if (nr) { s += nr.d; n++ } } return s / n }

// ── ICP: city TPS -> refine on coastline correspondences ──
let warp = makeWarp(cityJ, cityG, 0)
console.log(`mean coast distance — city-TPS init: ${meanDist(warp).toFixed(1)}px`)
const SUB = 130
for (let iter = 0; iter < 4; iter++) {
  const src = [...cityJ], dst = [...cityG]
  const stride = Math.ceil(jCoast.length / SUB)
  for (let i = 0; i < jCoast.length; i += stride) {
    const jp = jCoast[i], w = warp(jp), nr = nearest(w[0], w[1])
    if (nr && nr.d < 80) { src.push(jp); dst.push(nr.p) } // reject far outliers
  }
  warp = makeWarp(src, dst, 0.5) // light regularization (dense, noisy points)
  console.log(`  ICP iter ${iter + 1}: ${src.length - cityJ.length} coast pairs, mean dist ${meanDist(warp).toFixed(1)}px`)
}

// ── render overlay: geodata coast (dark) vs warped jDip coast (red) ──
const dots = (pts, color, r) => pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r}" fill="${color}"/>`).join('')
const warpedJ = jCoast.map(warp)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#eee"/>${dots(gCoast.filter((_, i) => i % 3 === 0), '#888', 1.2)}${dots(warpedJ, '#c00', 1.4)}</svg>`
writeFileSync('/tmp/coast-align.svg', svg)
console.log('wrote /tmp/coast-align.svg (grey = real coast, red = warped jDip coast)')
