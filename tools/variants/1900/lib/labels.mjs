// Automatic label placement. For each label, rasterize its province, block out
// symbols and labels already placed, and compute a distance field; then search
// positions, angles and sizes for the label box with the most clearance,
// preferring the hinted position and angle.

// Approximate advance width per character, as a fraction of the font size.
const ADVANCE = { sc: 0.64, land: 0.52, sea: 0.74 }
export const labelBox = ({ text, size, kind }) => ({ w: text.length * size * ADVANCE[kind] + (kind === 'sea' ? 2 * text.length : 0), h: size * 0.78 })

const bboxOf = (g) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of g) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [Math.floor(x0) - 2, Math.floor(y0) - 2, Math.ceil(x1) + 2, Math.ceil(y1) + 2]
}

function rasterize(g, [x0, y0, x1, y1]) {
  const w = x1 - x0, h = y1 - y0, grid = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const cy = y0 + y + 0.5, xs = []
    for (const p of g) for (const r of p) for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i], [bx, by] = r[(i + 1) % r.length]
      if ((ay > cy) !== (by > cy)) xs.push(ax + (cy - ay) * (bx - ax) / (by - ay))
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.max(0, Math.ceil(xs[i] - x0 - 0.5)); x < Math.min(w, xs[i + 1] - x0 - 0.5); x++) grid[y * w + x] = 1
  }
  return { grid, w, h }
}

// Chamfer distance to the nearest blocked cell.
function distanceField({ grid, w, h }) {
  const d = new Float32Array(w * h), D2 = Math.SQRT2
  for (let i = 0; i < d.length; i++) d[i] = grid[i] ? 1e6 : 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue
    let v = d[i]
    v = Math.min(v, x ? d[i - 1] + 1 : 0, y ? d[i - w] + 1 : 0, x && y ? d[i - w - 1] + D2 : 0, y && x < w - 1 ? d[i - w + 1] + D2 : 0)
    d[i] = v
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue
    let v = d[i]
    v = Math.min(v, x < w - 1 ? d[i + 1] + 1 : 0, y < h - 1 ? d[i + w] + 1 : 0, x < w - 1 && y < h - 1 ? d[i + w + 1] + D2 : 0, y < h - 1 && x ? d[i + w - 1] + D2 : 0)
    d[i] = v
  }
  return d
}

// Rotated rectangle sample points (corners, edges and interior grid).
const rectPoints = ([cx, cy], w, h, deg) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), pts = []
  const nx = Math.max(2, Math.ceil(w / 3)), ny = Math.max(2, Math.ceil(h / 3))
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    const u = (i / nx - 0.5) * w, v = (j / ny - 0.5) * h
    pts.push([cx + u * c - v * s, cy + u * s + v * c])
  }
  return pts
}

export class LabelPlacer {
  constructor() { this.blocked = [] } // [{ points }] in board units
  block(points) { this.blocked.push(points) }
  blockCircle([x, y], r) { const pts = []; for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (dx * dx + dy * dy <= r * r) pts.push([x + dx, y + dy]); this.block(pts) }
  blockLabel(at, w, h, angle) { this.block(rectPoints(at, w + 4, h + 3, angle)) }

  // Returns { at, angle, size } or null.
  place(geom, { text, size, kind, at: hint, angle: hintAngle = 0, minSize = 10, angles }, center) {
    hint ??= center
    const box = bboxOf(geom), [x0, y0] = box
    const field = rasterize(geom, box)
    for (const pts of this.blocked) for (const [x, y] of pts) {
      const gx = Math.floor(x - x0), gy = Math.floor(y - y0)
      if (gx >= 0 && gy >= 0 && gx < field.w && gy < field.h) field.grid[gy * field.w + gx] = 0
    }
    const d = distanceField(field)
    const at = ([x, y]) => { const gx = Math.floor(x - x0), gy = Math.floor(y - y0); return gx < 0 || gy < 0 || gx >= field.w || gy >= field.h ? 0 : d[gy * field.w + gx] }
    const tryAngles = angles ?? [...new Set([hintAngle, 0, -10, 10, -20, 20, -30, 30, -45, 45, -60, 60, -75, 75, -90])]
    const step = Math.max(2, Math.round(Math.sqrt(field.w * field.h) / 60))
    let best = null
    for (let sz = size; sz >= minSize; sz--) {
      const { w, h } = labelBox({ text, size: sz, kind })
      for (const angle of tryAngles) for (let y = y0 + 2; y < box[3] - 2; y += step) for (let x = x0 + 2; x < box[2] - 2; x += step) {
        if (at([x, y]) < h / 2 + 1) continue
        let clear = Infinity
        for (const p of rectPoints([x, y], w, h, angle)) { clear = Math.min(clear, at(p)); if (clear < 1.2) break }
        if (clear < 1.2) continue
        const score = Math.min(clear, 5) * 3 + sz * 5 - Math.abs(angle - hintAngle) * 0.08 - Math.abs(angle) * 0.04 - (hint ? Math.hypot(x - hint[0], y - hint[1]) * 0.12 : 0)
        if (!best || score > best.score) best = { score, at: [x, y], angle, size: sz, w, h }
      }
    }
    if (best) this.blockLabel(best.at, best.w, best.h, best.angle)
    return best
  }
}
