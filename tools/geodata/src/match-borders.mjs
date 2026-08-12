// Match geodata province borders to the jDip 1900 source borders.
//   - transform jDip 1900 province shapes into geodata space (the TARGET borders),
//   - assign each admin-1 unit to the TARGET province that CONTAINS it (point-in-polygon
//     against the real 1900 shapes — not nearest midpoint),
//   - dissolve admin units per province -> land provinces with real admin borders whose
//     EXTENT follows 1900,
//   - MEASURE the match: per-province IoU (intersection-over-union of area) vs the jDip
//     target, + mean. (Sea provinces ignored for now; coastlines retained.)
import { readFileSync, writeFileSync } from 'node:fs'
import { geoMercator, geoPath } from 'd3-geo'
import pc from 'polygon-clipping'
import { map1900 } from '../../../src/lib/maps/1900.ts'

const here = new URL('.', import.meta.url)
const admin = JSON.parse(readFileSync(new URL('admin1.geojson', here), 'utf8'))
const dsvg = readFileSync(new URL('../../../public/maps/1900.dsvg', here), 'utf8')

// ── projection + affine (jDip 1522 space -> geodata px) ──
const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
const corners = { type: 'MultiPoint', coordinates: [
  [REGION.lonMin, REGION.latMin], [REGION.lonMax, REGION.latMin],
  [REGION.lonMax, REGION.latMax], [REGION.lonMin, REGION.latMax]] }
const W = 1522
const proj = geoMercator()
proj.fitWidth(W, corners)
const H = Math.ceil(geoPath(proj).bounds(corners)[1][1])
// Control points: province -> real [lon, lat]. Spread across the whole region (esp. the
// periphery) so the thin-plate spline is well-constrained everywhere.
const REF = {
  // British Isles + Iceland
  ICE: [-19, 64.9], CLY: [-4.25, 55.9], EDI: [-3.19, 55.95], LVP: [-2.99, 53.4],
  LON: [-0.13, 51.5], WAL: [-3.8, 52.3], YOR: [-1.5, 53.8], IRE: [-8, 53.3],
  // Scandinavia + Baltic
  NWY: [10.7, 59.9], SWE: [16.0, 59.3], DEN: [10.0, 56.0], FIN: [25.5, 62.5], STP: [30.3, 59.9],
  // Iberia + France + Low Countries
  POR: [-8.2, 39.5], SPA: [-3.7, 40.4], GAS: [-0.58, 44.8], BRE: [-3.0, 48.2], PAR: [2.35, 48.85],
  PIC: [2.8, 49.9], BUR: [4.8, 47.2], MAR: [5.37, 43.6], BEL: [4.35, 50.85], NET: [5.3, 52.2],
  ALS: [7.0, 48.3], SWI: [8.0, 46.8],
  // Germany + central
  KIE: [10.0, 54.1], BER: [13.4, 52.5], MUN: [11.6, 48.3], COL: [7.5, 50.9], PRU: [20.0, 54.2], SIL: [16.5, 51.0],
  // Italy
  PIE: [7.7, 45.0], VEN: [12.0, 45.8], ROM: [12.5, 41.9], NAP: [14.25, 40.85], APU: [16.6, 41.0],
  // Austria-Hungary + Balkans
  TYR: [11.4, 47.0], BOH: [14.4, 49.9], VIE: [16.37, 48.2], BUD: [19.0, 47.0], GAL: [24.0, 49.5],
  TRI: [14.0, 45.5], BOS: [18.0, 44.0], SER: [20.5, 44.0], GRE: [22.5, 39.5], BUL: [24.5, 42.5], RUM: [26.0, 45.5],
  // East
  WAR: [21.0, 52.2], MOS: [37.6, 55.75], LVO: [25.0, 57.0], UKR: [31.0, 49.5], SEV: [34.5, 45.5], SIB: [50, 58],
  // Turkey + Levant + Arabia
  CON: [28.98, 41.0], ANK: [33.0, 39.9], ARM: [42.0, 39.8], KON: [33.0, 37.5], DAM: [37.0, 34.0],
  PAL: [35.5, 31.8], EGY: [31.0, 28.5], HEJ: [39.0, 24.0], ARA: [45.0, 27.0],
  // North Africa
  MOR: [-6.5, 32.5], ALG: [3.0, 35.5], TUN: [9.5, 35.5], TRP: [15.0, 31.5], CYR: [21.0, 31.0], SOU: [2.0, 28.0],
}

// ── thin-plate-spline warp  jDip(x,y) -> geodata px ──
const gauss = (A, b) => {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const piv = M[c][c] || 1e-12
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / piv; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  return M.map((r, c) => r[n] / (r[c] || 1e-12))
}
const phi = (r2) => (r2 > 1e-12 ? 0.5 * r2 * Math.log(r2) : 0) // r^2 log r
const buildTPS = (src, dst, lam) => {
  const n = src.length, m = n + 3
  const L = Array.from({ length: m }, () => new Array(m).fill(0))
  const b = new Array(m).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = src[i][0] - src[j][0], dy = src[i][1] - src[j][1]
      L[i][j] = i === j ? lam : phi(dx * dx + dy * dy)
    }
    L[i][n] = 1; L[i][n + 1] = src[i][0]; L[i][n + 2] = src[i][1]
    L[n][i] = 1; L[n + 1][i] = src[i][0]; L[n + 2][i] = src[i][1]
    b[i] = dst[i]
  }
  const s = gauss(L, b)
  return (p) => {
    let v = s[n] + s[n + 1] * p[0] + s[n + 2] * p[1]
    for (let i = 0; i < n; i++) { const dx = p[0] - src[i][0], dy = p[1] - src[i][1]; v += s[i] * phi(dx * dx + dy * dy) }
    return v
  }
}
const cps = Object.entries(REF).filter(([id]) => map1900.territories[id]).map(([id, ll]) => ({ j: map1900.territories[id].render.center, g: proj(ll) }))
const src = cps.map((c) => c.j)
const fx = buildTPS(src, cps.map((c) => c.g[0]), 0)
const fy = buildTPS(src, cps.map((c) => c.g[1]), 0)
const toGeo = (p) => [fx(p), fy(p)]
let maxres = 0
for (const c of cps) { const g = toGeo(c.j); maxres = Math.max(maxres, Math.hypot(g[0] - c.g[0], g[1] - c.g[1])) }
console.log(`TPS over ${cps.length} control points, max residual ${maxres.toFixed(2)}px`)

// ── parse 1900.dsvg province paths -> rings of points (absolute M/C/L/Z) ──
const FLAT = 6
const flatten = (d) => {
  const toks = d.match(/[MLCZ]|-?\d*\.?\d+/g) || []
  const rings = []; let cur = null, x = 0, y = 0, i = 0, cmd = ''
  const cubic = (x1, y1, x2, y2, x3, y3) => { for (let k = 1; k <= FLAT; k++) { const t = k / FLAT, u = 1 - t; cur.push([u*u*u*x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3, u*u*u*y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3]) } x = x3; y = y3 }
  while (i < toks.length) {
    if (/[A-Z]/.test(toks[i])) { cmd = toks[i++]; if (cmd === 'M') { if (cur?.length) rings.push(cur); cur = []; x = +toks[i++]; y = +toks[i++]; cur.push([x, y]) } else if (cmd === 'Z') { if (cur?.length) { rings.push(cur); cur = null } } continue }
    if (cmd === 'L') { x = +toks[i++]; y = +toks[i++]; cur.push([x, y]) }
    else if (cmd === 'C') { const a = +toks[i++], b = +toks[i++], c = +toks[i++], e = +toks[i++], f = +toks[i++], g = +toks[i++]; cubic(a, b, c, e, f, g) }
    else i++
  }
  if (cur?.length) rings.push(cur)
  return rings
}
const provLayer = dsvg.match(/<g id="provinces">([\s\S]*?)<\/g>/)[1]
const TARGET = {} // id(UPPER) -> {rings:[[ [x,y] ]], bbox, cx, cy} in geodata px
for (const m of provLayer.matchAll(/<path id="([a-z/]+)" d="([^"]*)"/g)) {
  const id = m[1].toUpperCase()
  const t = map1900.territories[id]
  if (!t || t.type === 'sea') continue // land/coast only
  const rings = flatten(m[2]).map((r) => r.map(toGeo))
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, sx = 0, sy = 0, n = 0
  for (const r of rings) for (const [px, py] of r) { minx = Math.min(minx, px); miny = Math.min(miny, py); maxx = Math.max(maxx, px); maxy = Math.max(maxy, py); sx += px; sy += py; n++ }
  TARGET[id] = { rings, bbox: [minx, miny, maxx, maxy], cx: sx / n, cy: sy / n }
}
const targetIds = Object.keys(TARGET)
console.log(`targets: ${targetIds.length} land/coast provinces`)

// point-in-polygon (even-odd over all rings)
const inRings = (px, py, rings) => {
  let inside = false
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

// ── assign admin units to the TARGET province that contains them ──
const projRing = (ring) => ring.map((c) => proj(c)).filter((p) => p && isFinite(p[0]))
const featMP = (f) => f.geometry.type === 'Polygon' ? [f.geometry.coordinates.map(projRing)] : f.geometry.coordinates.map((p) => p.map(projRing))
const centroid = (f) => { let sx = 0, sy = 0, n = 0; const w = (a) => { if (typeof a[0] === 'number') { const p = proj(a); if (p) { sx += p[0]; sy += p[1]; n++ } } else a.forEach(w) }; w(f.geometry.coordinates); return n ? [sx / n, sy / n] : null }
const inRegion = (f) => { const pad = 6, t = (c) => c[0] >= REGION.lonMin - pad && c[0] <= REGION.lonMax + pad && c[1] >= REGION.latMin - pad && c[1] <= REGION.latMax + pad; const w = (a) => (typeof a[0] === 'number') ? t(a) : a.some(w); return w(f.geometry.coordinates) }

const byProvince = {}
let assigned = 0, byContain = 0
for (const f of admin.features) {
  if (!inRegion(f)) continue
  const c = centroid(f); if (!c) continue
  // candidates: provinces whose bbox contains the centroid AND PiP succeeds
  let hit = []
  for (const id of targetIds) { const b = TARGET[id].bbox; if (c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3] && inRings(c[0], c[1], TARGET[id].rings)) hit.push(id) }
  let id
  if (hit.length) { byContain++; id = hit.length === 1 ? hit[0] : hit.sort((a, b) => Math.hypot(TARGET[a].cx - c[0], TARGET[a].cy - c[1]) - Math.hypot(TARGET[b].cx - c[0], TARGET[b].cy - c[1]))[0] }
  else { let bd = Infinity; for (const t of targetIds) { const d = Math.hypot(TARGET[t].cx - c[0], TARGET[t].cy - c[1]); if (d < bd) { bd = d; id = t } } } // fallback: nearest target
  let mp; try { mp = featMP(f) } catch { continue }
  byProvince[id] = byProvince[id] ? pc.union(byProvince[id], mp) : mp
  assigned++
}
console.log(`assigned ${assigned} admin units (${byContain} by containment, ${assigned - byContain} by nearest-fallback) to ${Object.keys(byProvince).length} provinces`)

// ── measure: IoU(dissolved, target) per province ──
const area = (mp) => { let a = 0; for (const poly of mp) for (let pi = 0; pi < poly.length; pi++) { const ring = poly[pi]; let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); a += (pi === 0 ? 1 : -1) * Math.abs(s / 2) } return a }
const targetMP = (id) => TARGET[id].rings.map((r) => [r])
const ious = []
for (const id of targetIds) {
  if (!byProvince[id]) { ious.push({ id, iou: 0 }); continue }
  const A = byProvince[id], B = targetMP(id)
  let inter = 0, uni = 1
  try { const I = pc.intersection(A, B); inter = I.length ? area(I) : 0; const U = pc.union(A, B); uni = U.length ? area(U) : 1 } catch {}
  ious.push({ id, iou: uni ? inter / uni : 0 })
}
ious.sort((a, b) => a.iou - b.iou)
const mean = ious.reduce((s, x) => s + x.iou, 0) / ious.length
console.log(`\nIoU vs jDip 1900 shapes — mean ${(mean * 100).toFixed(0)}%`)
console.log('worst 12:', ious.slice(0, 12).map((x) => `${x.id} ${(x.iou * 100).toFixed(0)}%`).join('  '))
console.log('best 6:', ious.slice(-6).map((x) => `${x.id} ${(x.iou * 100).toFixed(0)}%`).join('  '))

// ── render: dissolved land provinces + faint jDip target outline overlay ──
const LAND = '#d4d0ad', SEA = '#cbc5a0', BORDER = '#4a4636', TGT = 'rgba(190,40,40,0.6)'
const ring2d = (r) => `M ${r.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')} Z`
const mp2d = (mp) => mp.map((poly) => poly.map(ring2d).join(' ')).join(' ')
const fills = targetIds.filter((id) => byProvince[id]).map((id) => `<path d="${mp2d(byProvince[id])}" fill="${LAND}" stroke="${BORDER}" stroke-width="1" stroke-linejoin="round"/>`)
const tgt = targetIds.map((id) => `<path d="${TARGET[id].rings.map(ring2d).join(' ')}" fill="none" stroke="${TGT}" stroke-width="0.8"/>`)
writeFileSync('/tmp/geo-match.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${SEA}"/>${fills.join('')}</svg>`)
writeFileSync('/tmp/geo-match-overlay.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${SEA}"/>${fills.join('')}${tgt.join('')}</svg>`)
console.log('wrote /tmp/geo-match.svg (+ -overlay with jDip target borders in red)')
