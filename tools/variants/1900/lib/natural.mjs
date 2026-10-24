// Real administrative borders (Natural Earth admin-1), for provinces the classical
// board does not draw: grouped into 1900 provinces in lon/lat, then transformed
// onto the board.
import { readFileSync } from 'node:fs'
import { union } from './geom.mjs'

let admin1
const features = () => (admin1 ??= JSON.parse(readFileSync(new URL('../../../geodata/src/admin1.geojson', import.meta.url), 'utf8')).features)

const polygonsOf = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
const centroid = (f) => {
  const pts = polygonsOf(f).flatMap((p) => p[0])
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

// Union of the admin-1 units for which pick(country, name, [lon, lat]) is true.
export function region(pick) {
  const parts = features().filter((f) => pick(f.properties.admin, f.properties.name, centroid(f)))
  return union(...parts.map((f) => polygonsOf(f)))
}

export const transform = (g, f) => g.map((p) => p.map((r) => r.map(f)))

// A lon/lat box with densely sampled edges, so it stays faithful to curved parallels once projected.
export function box(west, south, east, north, step = 0.25) {
  const ring = []
  const edge = (a, b) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 0; k < n; k++) ring.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]) }
  edge([west, south], [east, south]); edge([east, south], [east, north]); edge([east, north], [west, north]); edge([west, north], [west, south])
  return [[ring]]
}

// Least-squares affine map from point pairs.
export function affine(pairs) {
  const solve = (k) => {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0]
    for (const [[x, y], to] of pairs) { const r = [x, y, 1]; for (let a = 0; a < 3; a++) { v[a] += r[a] * to[k]; for (let c = 0; c < 3; c++) M[a][c] += r[a] * r[c] } }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) { const f = M[j][i] / M[i][i]; for (let c = 0; c < 3; c++) M[j][c] -= f * M[i][c]; v[j] -= f * v[i] }
    return v.map((x, i) => x / M[i][i])
  }
  const cx = solve(0), cy = solve(1)
  return ([x, y]) => [cx[0] * x + cx[1] * y + cx[2], cy[0] * x + cy[1] * y + cy[2]]
}
