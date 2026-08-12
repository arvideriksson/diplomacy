// Reconnaissance for the admin-1 -> jDip-province mapping. For each admin-1 unit in the
// region, find which 1900 EMPIRE it belonged to (point-in-polygon vs historical-basemaps,
// in lon/lat) — this groups units correctly across modern borders. Output: 1900 empire ->
// its admin-1 units (region name + modern country), the raw material for the province map.
import { readFileSync } from 'node:fs'
const here = new URL('.', import.meta.url)
const admin = JSON.parse(readFileSync(new URL('admin1.geojson', here), 'utf8'))
const hist = JSON.parse(readFileSync(new URL('hist1900.geojson', here), 'utf8'))

const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
const inReg = (lon, lat) => lon >= REGION.lonMin && lon <= REGION.lonMax && lat >= REGION.latMin && lat <= REGION.latMax

// centroid (avg of coords) in lon/lat
const centroid = (geom) => { let sx = 0, sy = 0, n = 0; const w = (a) => { if (typeof a[0] === 'number') { sx += a[0]; sy += a[1]; n++ } else a.forEach(w) }; w(geom.coordinates); return [sx / n, sy / n] }

// point-in-polygon (even-odd) over a Polygon/MultiPolygon's rings, in lon/lat
const pip = (lon, lat, geom) => {
  let inside = false
  const ring = (r) => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if (((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside } }
  if (geom.type === 'Polygon') geom.coordinates.forEach(ring)
  else geom.coordinates.forEach((poly) => poly.forEach(ring))
  return inside
}

const empireOf = (lon, lat) => { for (const f of hist.features) { try { if (pip(lon, lat, f.geometry)) return f.properties.NAME || f.properties.name || '?' } catch {} } return '(none)' }

const groups = {} // empire -> [{name, country}]
for (const f of admin.features) {
  const [lon, lat] = centroid(f.geometry)
  if (!inReg(lon, lat)) continue
  const emp = empireOf(lon, lat)
  const p = f.properties
  ;(groups[emp] ||= []).push({ name: p.name || p.name_local || '?', country: p.admin || p.geonunit || '?' })
}

for (const emp of Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length)) {
  const us = groups[emp]
  console.log(`\n=== ${emp} (${us.length} admin-1 units) ===`)
  // group by modern country for readability
  const byC = {}
  for (const u of us) (byC[u.country] ||= []).push(u.name)
  for (const c of Object.keys(byC).sort()) console.log(`  [${c}] ${byC[c].sort().join(', ')}`)
}
