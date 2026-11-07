// Polygon helpers for editing the classical partition. Geometry is polygon-clipping
// MultiPolygons ([[ring, hole...], ...]) in board units.
import pc from 'polygon-clipping'

// polygon-clipping can fail on nearly coincident edges; snapping inputs to a fine
// grid (retrying coarser) keeps the shared classical borders robust.
const asMulti = (g) => (typeof g[0][0][0] === 'number' ? [g] : g)
const snap = (g, k) => asMulti(g).map((p) => p.map((r) => r.map(([x, y]) => [Math.round(x * k) / k, Math.round(y * k) / k])))
const robust = (op) => (...gs) => {
  for (const k of [1000, 200, 50]) {
    try { return op(...gs.map((g) => snap(g, k))) } catch (e) { if (k === 50) throw e }
  }
}
const pcUnion = robust(pc.union), pcIntersection = robust(pc.intersection), pcDifference = robust(pc.difference)
export const union = (...gs) => { const live = gs.filter((g) => g?.length); return live.length ? pcUnion(...live) : [] }
export const intersect = (a, b) => (a?.length && b?.length ? pcIntersection(a, b) : [])
export const subtract = (a, ...bs) => { const live = bs.filter((g) => g?.length); return !a?.length ? [] : live.length ? pcDifference(a, ...live) : a }
export const poly = (points) => [[points]]

export const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1] } return a / 2 }
export const area = (g) => g.reduce((s, p) => s + Math.abs(ringArea(p[0])) - p.slice(1).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0)

const inRing = ([x, y], r) => {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export const contains = (g, p) => g.some((pl) => inRing(p, pl[0]) && !pl.slice(1).some((h) => inRing(p, h)))

/** Distance from point p to segment a–b. */
export const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
export const boundaryDistance = (g, p) => {
  let d = Infinity
  for (const pl of g) for (const r of pl) for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(p, r[i], r[(i + 1) % r.length]))
  return d
}

// Point deepest inside the shape (pole of inaccessibility), by coarse-to-fine grid search.
export function pole(g, weight = () => 1) {
  const xs = g.flatMap((p) => p[0].map((q) => q[0])), ys = g.flatMap((p) => p[0].map((q) => q[1]))
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  let best = null
  for (let step = Math.max(x1 - x0, y1 - y0) / 24; step > 0.5; step /= 3) {
    for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) {
      const p = [x, y]
      if (!contains(g, p)) continue
      const d = boundaryDistance(g, p) * weight(p)
      if (!best || d > best.d) best = { p, d }
    }
    if (!best) break
    ;[x0, x1, y0, y1] = [best.p[0] - step, best.p[0] + step, best.p[1] - step, best.p[1] + step]
  }
  return best ? { point: best.p, radius: boundaryDistance(g, best.p) } : null
}

// Organic border: densify a polyline and displace it sideways with smooth,
// deterministic noise, so drawn cuts resemble the hand-traced classical borders.
export function wiggle(points, { amplitude = 2.2, step = 3, seed = 1 } = {}) {
  const out = []
  let s = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / step))
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len
    for (let k = 0; k < n; k++) {
      const t = k / n, d = s + t * len
      const taper = Math.min(1, d / 8, (i === points.length - 2 ? (1 - t) * len : Infinity) / 8)
      const off = amplitude * taper * (Math.sin(d * 0.21 + seed) * 0.6 + Math.sin(d * 0.53 + seed * 2.3) * 0.3 + Math.sin(d * 1.37 + seed * 4.1) * 0.25)
      out.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off])
    }
    s += len
  }
  out.push(points.at(-1))
  return out
}

// Smooth curve through points (Catmull-Rom), for sea borders, which classical draws as curves.
export function curve(points, step = 4) {
  const out = []
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)]
    const n = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step))
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)))
    }
  }
  out.push(points.at(-1))
  return out
}

// A closed polygon whose boundary follows `cut` and is closed around the far side
// through `around` (points well outside every province that should be split).
export const sidePolygon = (cut, around, opts) => poly([...wiggle(cut, opts), ...around])

// Buffer a polyline by r (union of segment quads and vertex discs). `r` may be a
// function of the vertex index, for strips that taper toward one end.
export function buffer(line, r) {
  const radius = typeof r === 'function' ? r : () => r
  const pieces = []
  const disc = ([x, y], q) => [Array.from({ length: 14 }, (_, k) => [x + q * Math.cos(k * Math.PI / 7), y + q * Math.sin(k * Math.PI / 7)])]
  for (let i = 0; i < line.length; i++) {
    const q = radius(i, line.length)
    pieces.push(disc(line[i], q))
    if (i + 1 < line.length) {
      const q2 = radius(i + 1, line.length)
      const [a, b] = [line[i], line[i + 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len
      pieces.push([[[a[0] + nx * q, a[1] + ny * q], [b[0] + nx * q2, b[1] + ny * q2], [b[0] - nx * q2, b[1] - ny * q2], [a[0] - nx * q, a[1] - ny * q]]])
    }
  }
  return pcUnion(...pieces)
}

// Douglas-Peucker simplification of an open polyline.
export function simplify(pts, tol) {
  if (pts.length < 3) return pts
  let max = 0, idx = 0
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts.at(-1)); if (d > max) { max = d; idx = i } }
  return max > tol ? [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)] : [pts[0], pts.at(-1)]
}

// The largest polygon of a MultiPolygon (the first of equal ones).
export const largestPiece = (g) => g.reduce((a, b) => (area([b]) > area([a]) ? b : a))

// A strip of width w along a polyline (a canal), as a polygon.
export const channel = (pts, w) => {
  const side = (s) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1])
    return [p[0] - s * w / 2 * (b[1] - a[1]) / len, p[1] + s * w / 2 * (b[0] - a[0]) / len]
  })
  return poly([...side(1), ...side(-1).reverse()])
}
// A polyline lengthened by d at both ends, along its end segments.
export const extendEnds = (pts, d) => {
  const out = (p, q) => { const len = Math.hypot(p[0] - q[0], p[1] - q[1]); return [p[0] + (p[0] - q[0]) / len * d, p[1] + (p[1] - q[1]) / len * d] }
  return [out(pts[0], pts[1]), ...pts, out(pts.at(-1), pts.at(-2))]
}

// Distance from p to a rotated rectangle (centre `at`, size w×h, `angle` in degrees); 0 inside.
export const rectDistance = (p, { at, w, h, angle }) => {
  const a = -angle * Math.PI / 180, dx = p[0] - at[0], dy = p[1] - at[1]
  const u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.hypot(Math.max(0, Math.abs(u) - w / 2), Math.max(0, Math.abs(v) - h / 2))
}

// The best-scoring point of a 2-unit grid over polygon `piece`'s bounding box, among points
// inside it: { p, score }, or null if no grid point is inside. Ties keep the first point found.
export function bestGridPoint(piece, score, step = 2) {
  const g = [piece], xs = piece[0].map((q) => q[0]), ys = piece[0].map((q) => q[1])
  let best = null
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
    if (!contains(g, [x, y])) continue
    const s = score([x, y])
    if (!best || s > best.score) best = { score: s, p: [x, y] }
  }
  return best
}

// Two ways of removing zero-width spikes (a ring running out to a point and straight back),
// tuned to their boards; they are not interchangeable without changing the output.
// - despikeReturns (1900, one ring): drops a vertex whose neighbours almost coincide (< 0.3
//   apart) while it sits off them (> 0.5); four passes, never below 5 vertices. Suited to
//   the classical board's hand-drawn edits, where spikes come back to the same point.
// - despikeReversals (Era, a whole MultiPolygon): drops a vertex where the ring turns back on
//   itself (direction reverses within ~6°, nearly collinear) or that repeats its neighbour,
//   until nothing changes; then drops holes without area and polygons left degenerate. Suited
//   to pixel-traced geometry, where spikes come back along a slightly different path.
export const despikeReturns = (ring) => {
  const r = ring.slice()
  for (let pass = 0; pass < 4; pass++) for (let i = 0; i < r.length && r.length > 4; i++) {
    const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length]
    if (Math.hypot(a[0] - c[0], a[1] - c[1]) < 0.3 && Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.5) { r.splice(i, 1); i-- }
  }
  return r
}
export const despikeReversals = (g) => g.map((pl) => pl.map((ring) => {
  let r = ring.slice(), changed = true
  while (changed && r.length > 3) {
    changed = false
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i - 1 + r.length) % r.length], v = r[i], b = r[(i + 1) % r.length]
      const ux = v[0] - a[0], uy = v[1] - a[1], wx = b[0] - v[0], wy = b[1] - v[1], lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy)
      if (lu < 1e-6 || lw < 1e-6 || ((ux * wx + uy * wy) / (lu * lw) < -0.995 && Math.abs(ux * wy - uy * wx) < 0.05 * Math.max(lu, lw))) { r.splice(i, 1); i--; changed = true }
    }
  }
  return r
}).filter((r, j) => j === 0 || (r.length > 3 && area([[r]]) >= 0.5))).filter((pl) => pl[0].length > 3)
