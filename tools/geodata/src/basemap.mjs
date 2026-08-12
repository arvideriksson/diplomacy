// Shared 1900 base-map builder: the land mask + empire-coloured polities that ARE the
// 1900iterative map. Used by 1900iterative.mjs (writes the SVG) and the map editor's
// build-units.mjs (embeds the identical base layer + clips cells to the same land mask),
// so the editor matches 1900iterative.svg exactly.
import pc from 'polygon-clipping'
import { isGreenland, inReg, clipProject } from './projection.mjs'

export const EMPIRE_COLOR = { Germany: '#8c929f', 'Austria Hungary': '#f0574e', 'Ottoman Empire': '#f5af20', 'Russian Empire': '#9975fa', France: '#4b85fe', Italy: '#4aa961', 'United Kingdom of Great Britain and Ireland': '#5fa8d3', 'Sweden–Norway': '#cdb06a' }
export const NEUTRAL = '#d4d0ad'
export const BG = '#cbc5a0'
export const EMPIRE_OPACITY = 0.55
export const EMPIRE_STROKE = '#4a4636'

const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2) }
const mpArea = (mp) => mp.reduce((s, poly) => s + (poly[0] ? ringArea(poly[0]) : 0), 0)
const centroidLL = (g) => { let sx = 0, sy = 0, n = 0; const w = (a) => { if (typeof a[0] === 'number') { sx += a[0]; sy += a[1]; n++ } else a.forEach(w) }; w(g.coordinates); return [sx / n, sy / n] }
export const mp2path = (mp) => mp.map((poly) => poly.map((r) => `M${r.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`).join('')).join('')
export const nameOf = (f) => f.properties.NAME || f.properties.name || ''

// Union of kept (non-small-island) land features. Island threshold = smallest of
// Crete/Cyprus/Gotland (by nearest land feature). This IS the map's coastline.
export function buildLandMask(land) {
  const feats = land.features.filter((f) => inReg(f) && !isGreenland(f)).map((f) => ({ mp: clipProject(f), c: centroidLL(f.geometry) })).filter((f) => f.mp.length)
  for (const f of feats) f.area = mpArea(f.mp)
  const REFS = [[24.8, 35.2], [33.4, 35.1], [18.5, 57.5]]
  const nearestArea = (lon, lat) => feats.reduce((b, f) => ((f.c[0] - lon) ** 2 + (f.c[1] - lat) ** 2) < ((b.c[0] - lon) ** 2 + (b.c[1] - lat) ** 2) ? f : b).area
  const threshold = Math.min(...REFS.map((ll) => nearestArea(ll[0], ll[1]))) * 0.98
  let mask = []
  for (const f of feats) if (f.area >= threshold) mask = mask.length ? pc.union(mask, f.mp) : f.mp
  return mask
}

// 1900 countries clipped to the land mask, coloured by empire — the base map layer.
export function buildPolities(hist, mask) {
  const out = []
  for (const f of hist.features) {
    if (!inReg(f) || isGreenland(f)) continue
    const polMP = clipProject(f)
    if (!polMP.length) continue
    let clipped; try { clipped = pc.intersection(polMP, mask) } catch { continue }
    if (!clipped.length) continue
    const isEmp = !!EMPIRE_COLOR[nameOf(f)]
    out.push({ name: nameOf(f), mp: clipped, fill: isEmp ? EMPIRE_COLOR[nameOf(f)] : NEUTRAL, opacity: isEmp ? EMPIRE_OPACITY : 1 })
  }
  return out
}
