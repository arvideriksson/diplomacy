// Prototype: 1900 political borders (historical-basemaps) clipped to real coastlines
// (Natural Earth) — i.e. 1900 politics + accurate coasts. Coloured by empire to show the
// 1900 extents (German Empire incl. Silesia/Prussia, Austria-Hungary, Ottoman, Russia
// incl. Finland/Poland, Sweden–Norway unified, …).
import { readFileSync, writeFileSync } from 'node:fs'
import { geoMercator, geoPath } from 'd3-geo'
import pc from 'polygon-clipping'

const here = new URL('.', import.meta.url)
const hist = JSON.parse(readFileSync(new URL('hist1900.geojson', here), 'utf8'))
const land = JSON.parse(readFileSync(new URL('land.geojson', here), 'utf8'))

const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
const corners = { type: 'MultiPoint', coordinates: [[REGION.lonMin, REGION.latMin], [REGION.lonMax, REGION.latMin], [REGION.lonMax, REGION.latMax], [REGION.lonMin, REGION.latMax]] }
const W = 1522
const proj = geoMercator()
proj.fitWidth(W, corners)
const H = Math.ceil(geoPath(proj).bounds(corners)[1][1])

const projRing = (r) => r.map((c) => proj(c)).filter((p) => p && isFinite(p[0]))
const featMP = (f) => f.geometry.type === 'Polygon' ? [f.geometry.coordinates.map(projRing)] : f.geometry.coordinates.map((p) => p.map(projRing))
const inReg = (f) => { const pad = 6, t = (c) => c[0] >= REGION.lonMin - pad && c[0] <= REGION.lonMax + pad && c[1] >= REGION.latMin - pad && c[1] <= REGION.latMax + pad; const w = (a) => typeof a[0] === 'number' ? t(a) : a.some(w); return w(f.geometry.coordinates) }

// real coastline mask
let landMask = []
for (const f of land.features) if (inReg(f)) landMask = landMask.length ? pc.union(landMask, featMP(f)) : featMP(f)
console.log('land mask parts:', landMask.length)

// empire palette (1900 powers + neutrals)
const COLOR = {
  Germany: '#8c929f', 'Austria Hungary': '#f0574e', 'Ottoman Empire': '#f5af20',
  'Russian Empire': '#9975fa', France: '#4b85fe', Italy: '#4aa961',
  'United Kingdom of Great Britain and Ireland': '#5fa8d3', 'Sweden–Norway': '#cdb06a',
}
const NEUTRAL = '#d4d0ad'
const ring2d = (r) => `M ${r.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')} Z`
const mp2d = (mp) => mp.map((poly) => poly.map(ring2d).join(' ')).join(' ')

const parts = []
for (const f of hist.features) {
  if (!inReg(f)) continue
  let clipped
  try { clipped = pc.intersection(featMP(f), landMask) } catch { continue }
  if (!clipped.length) continue
  const name = f.properties.NAME || f.properties.name || ''
  const fill = COLOR[name] ? `${COLOR[name]}` : NEUTRAL
  const op = COLOR[name] ? 0.55 : 1
  parts.push(`<path d="${mp2d(clipped)}" fill="${fill}" fill-opacity="${op}" stroke="#4a4636" stroke-width="1.1" stroke-linejoin="round"/>`)
}
console.log('rendered polities:', parts.length)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#cbc5a0"/>${parts.join('')}</svg>`
writeFileSync('/tmp/hist1900.svg', svg)
console.log('wrote /tmp/hist1900.svg')
