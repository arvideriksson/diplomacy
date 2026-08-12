// Build 1900 Diplomacy provinces from admin-1 units:
//   - each admin-1 unit -> its 1900 EMPIRE (point-in-polygon vs historical-basemaps),
//   - then -> a jDip province: clean country->province rules where a country maps to one
//     province, else constrained nearest-seed among only that empire's provinces,
//   - dissolve admin units per province (real coastlines + real admin borders, grouped to
//     the 1900 political map),
//   - validate adjacency from the dissolved geometry vs the jDip graph; report gaps.
import { readFileSync, writeFileSync } from 'node:fs'
import { geoMercator, geoPath } from 'd3-geo'
import pc from 'polygon-clipping'
import { map1900 } from '../../../src/lib/maps/1900.ts'

const here = new URL('.', import.meta.url)
const admin = JSON.parse(readFileSync(new URL('admin1.geojson', here), 'utf8'))
const hist = JSON.parse(readFileSync(new URL('hist1900.geojson', here), 'utf8'))

const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
const corners = { type: 'MultiPoint', coordinates: [[REGION.lonMin, REGION.latMin], [REGION.lonMax, REGION.latMin], [REGION.lonMax, REGION.latMax], [REGION.lonMin, REGION.latMax]] }
const W = 1522
const proj = geoMercator(); proj.fitWidth(W, corners)
const H = Math.ceil(geoPath(proj).bounds(corners)[1][1])

// ── TPS warp for province seeds (intra-country fallback) ──
const gauss = (A, b) => { const n = b.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;[M[c], M[p]] = [M[p], M[c]]; const pv = M[c][c] || 1e-9; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / pv; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] } } return M.map((r, c) => r[n] / (r[c] || 1e-9)) }
const phi = (r2) => (r2 > 1e-12 ? 0.5 * r2 * Math.log(r2) : 0)
const tps = (s, d) => { const n = s.length, m = n + 3, L = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0); for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { const dx = s[i][0] - s[j][0], dy = s[i][1] - s[j][1]; L[i][j] = phi(dx * dx + dy * dy) } L[i][n] = 1; L[i][n + 1] = s[i][0]; L[i][n + 2] = s[i][1]; L[n][i] = 1; L[n + 1][i] = s[i][0]; L[n + 2][i] = s[i][1]; b[i] = d[i] } const c = gauss(L, b); return (p) => { let v = c[n] + c[n + 1] * p[0] + c[n + 2] * p[1]; for (let i = 0; i < n; i++) { const dx = p[0] - s[i][0], dy = p[1] - s[i][1]; v += c[i] * phi(dx * dx + dy * dy) } return v } }
const REF = { ICE: [-19, 64.9], EDI: [-3.19, 55.95], LON: [-0.13, 51.5], IRE: [-8, 53.3], NWY: [10.7, 59.9], SWE: [16, 59.3], STP: [30.3, 59.9], PAR: [2.35, 48.85], SPA: [-3.7, 40.4], POR: [-8.2, 39.5], MAR: [5.37, 43.6], BER: [13.4, 52.5], ROM: [12.5, 41.9], NAP: [14.25, 40.85], VIE: [16.37, 48.2], BUD: [19, 47], MOS: [37.6, 55.75], CON: [28.98, 41], ANK: [33, 39.9], SEV: [34.5, 45.5], WAR: [21, 52.2], MOR: [-6.5, 32.5], EGY: [31, 28.5], GRE: [22.5, 39.5], DAM: [37, 34], SIL: [17, 51], KIE: [10, 54], MUN: [11.6, 48.3], GAL: [24, 49.5], HEJ: [39, 24], ARA: [45, 26] }
const cps = Object.entries(REF).filter(([id]) => map1900.territories[id]).map(([id, ll]) => ({ j: map1900.territories[id].render.center, g: proj(ll) }))
const fx = tps(cps.map((c) => c.j), cps.map((c) => c.g[0])), fy = tps(cps.map((c) => c.j), cps.map((c) => c.g[1]))
const seed = {} // province -> px seed
for (const id of Object.keys(map1900.territories)) { const c = map1900.territories[id].render.center; seed[id] = [fx(c), fy(c)] }

// ── 1900 empire -> provinces / province ──
const POLITY1 = { Belgium: 'BEL', Luxembourg: 'BEL', Netherlands: 'NET', Switzerland: 'SWI', Portugal: 'POR', Spain: 'SPA', Denmark: 'DEN', Iceland: 'ICE', Greece: 'GRE', Bulgaria: 'BUL', Romania: 'RUM', Serbia: 'SER', Montenegro: 'SER', 'Bosnia-Herzegovina': 'BOS', Morocco: 'MOR', Tunisia: 'TUN', Egypt: 'EGY' }
const POLITYN = {
  'United Kingdom of Great Britain and Ireland': ['CLY', 'EDI', 'LVP', 'YOR', 'WAL', 'LON', 'IRE'],
  France: ['BRE', 'PIC', 'PAR', 'GAS', 'BUR', 'MAR', 'ALS'],
  Germany: ['KIE', 'BER', 'MUN', 'COL', 'PRU', 'SIL'],
  Italy: ['PIE', 'MIL', 'VEN', 'ROM', 'NAP', 'APU'],
  'Austria Hungary': ['BOH', 'TYR', 'VIE', 'BUD', 'GAL', 'TRI'],
  'Russian Empire': ['STP', 'MOS', 'WAR', 'LVO', 'UKR', 'SEV', 'FIN', 'SIB'],
  'Ottoman Empire': ['CON', 'ANK', 'KON', 'ARM', 'DAM', 'PAL', 'HEJ', 'ARA', 'TRP', 'CYR'],
  'Sweden–Norway': ['SWE', 'NWY'],
  Algeria: ['ALG', 'SOU'],
}
// clean country -> province within an empire (skips nearest-seed where a country = a province)
const COUNTRY = {
  'United Kingdom of Great Britain and Ireland': { Ireland: 'IRE' },
  'Russian Empire': { Finland: 'FIN', Estonia: 'LVO', Latvia: 'LVO', Lithuania: 'LVO', Poland: 'WAR', Belarus: 'WAR', Ukraine: 'UKR', Moldova: 'UKR', Georgia: 'SEV', Kazakhstan: 'SIB' },
  'Austria Hungary': { 'Czech Republic': 'BOH', Hungary: 'BUD', Slovakia: 'BUD', Romania: 'BUD', Slovenia: 'TRI', Croatia: 'TRI', Italy: 'TRI', Poland: 'GAL', Ukraine: 'GAL', Liechtenstein: 'TYR' },
  'Ottoman Empire': { Syria: 'DAM', Lebanon: 'PAL', Israel: 'PAL', Jordan: 'PAL', 'West Bank': 'PAL', 'Gaza Strip': 'PAL', 'Saudi Arabia': 'HEJ', Iraq: 'ARA', Kuwait: 'ARA', Libya: 'TRP', Albania: 'GRE', Kosovo: 'SER', Macedonia: 'SER', Bulgaria: 'BUL', Greece: 'GRE', Egypt: 'EGY', Cyprus: 'CON' },
  'Sweden–Norway': { Sweden: 'SWE', Norway: 'NWY' },
}

// ── point-in-polygon (lon/lat) helpers ──
const centroidLL = (g) => { let sx = 0, sy = 0, n = 0; const w = (a) => { if (typeof a[0] === 'number') { sx += a[0]; sy += a[1]; n++ } else a.forEach(w) }; w(g.coordinates); return [sx / n, sy / n] }
const pip = (lon, lat, g) => { let inside = false; const ring = (r) => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if (((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside } }; if (g.type === 'Polygon') g.coordinates.forEach(ring); else g.coordinates.forEach((p) => p.forEach(ring)); return inside }
const empireOf = (lon, lat) => { for (const f of hist.features) { try { if (pip(lon, lat, f.geometry)) return f.properties.NAME || f.properties.name } catch {} } return null }

const projRing = (r) => r.map((c) => proj(c)).filter((p) => p && isFinite(p[0]))
const featMP = (f) => f.geometry.type === 'Polygon' ? [f.geometry.coordinates.map(projRing)] : f.geometry.coordinates.map((p) => p.map(projRing))
const inReg = (lon, lat) => lon >= REGION.lonMin - 4 && lon <= REGION.lonMax + 4 && lat >= REGION.latMin - 4 && lat <= REGION.latMax + 4

// ── assign ──
const byProvince = {}
let n = 0, fallback = 0, noEmpire = 0
for (const f of admin.features) {
  const [lon, lat] = centroidLL(f.geometry)
  if (!inReg(lon, lat)) continue
  const emp = empireOf(lon, lat)
  let id
  if (emp && POLITY1[emp]) id = POLITY1[emp]
  else if (emp && POLITYN[emp]) {
    const country = f.properties.admin
    id = COUNTRY[emp]?.[country]
    if (!id) { // constrained nearest-seed among the empire's provinces
      const px = proj([lon, lat]); let bd = Infinity
      for (const c of POLITYN[emp]) { const d = (seed[c][0] - px[0]) ** 2 + (seed[c][1] - px[1]) ** 2; if (d < bd) { bd = d; id = c } }
      fallback++
    }
  } else { // no 1900 empire (centroid in sea/edge) — global nearest-seed among land provinces
    noEmpire++
    const px = proj([lon, lat]); let bd = Infinity
    for (const c of Object.keys(map1900.territories)) { if (map1900.territories[c].type === 'sea') continue; const d = (seed[c][0] - px[0]) ** 2 + (seed[c][1] - px[1]) ** 2; if (d < bd) { bd = d; id = c } }
  }
  let mp; try { mp = featMP(f) } catch { continue }
  byProvince[id] = byProvince[id] ? pc.union(byProvince[id], mp) : mp
  n++
}
console.log(`assigned ${n} admin units (${fallback} via nearest-seed), ${noEmpire} skipped (no 1900 empire), to ${Object.keys(byProvince).length} provinces`)

// ── adjacency = provinces sharing boundary points (tiling → shared edges) ──
const ids = Object.keys(byProvince)
const cell = new Map() // grid cell -> Set(province) of boundary points there
const G = 3
for (const id of ids) for (const poly of byProvince[id]) for (const r of poly) for (const p of r) { const k = `${Math.round(p[0] / G)},${Math.round(p[1] / G)}`; let s = cell.get(k); if (!s) { s = new Set(); cell.set(k, s) } s.add(id) }
const geomAdj = new Set()
for (const s of cell.values()) { if (s.size < 2) continue; const a = [...s]; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) geomAdj.add([a[i], a[j]].sort().join('~')) }
const jdip = new Set()
for (const id of Object.keys(map1900.territories)) { const t = map1900.territories[id]; if (t.type === 'sea') continue; for (const nb of t.adjacent) { if (map1900.territories[nb]?.type === 'sea') continue; jdip.add([id, nb].sort().join('~')) } }
const matched = [...jdip].filter((p) => geomAdj.has(p)).length
const missing = [...jdip].filter((p) => !geomAdj.has(p))
console.log(`land adjacency: ${matched}/${jdip.size} jDip land-edges present (${(100 * matched / jdip.size).toFixed(0)}%)`)
console.log('missing edges (first 25):', missing.slice(0, 25).join(' '))

// ── render ──
const LAND = '#d4d0ad', SEA = '#cbc5a0', BORDER = '#4a4636'
const ring2d = (r) => `M ${r.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')} Z`
const mp2d = (mp) => mp.map((poly) => poly.map(ring2d).join(' ')).join(' ')
const paths = ids.map((id) => `<path d="${mp2d(byProvince[id])}" fill="${LAND}" stroke="${BORDER}" stroke-width="1" stroke-linejoin="round"/>`)
writeFileSync('/tmp/prov1900.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${SEA}"/>${paths.join('')}</svg>`)
console.log('wrote /tmp/prov1900.svg')
