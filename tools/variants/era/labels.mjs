// Label placement for the Era of Empire board.
//
// Each name is placed as near its province's centre as it fits, at the largest size that fits,
// on one line or broken over two or three, upright or tilted along the province's long axis.
// Labels keep clear of borders, coasts, supply centres, straits arrows and labels placed
// before them. A small province whose name does not fit inside it may spill into the seas
// around it (never onto other land).
import { readFileSync } from 'node:fs'
import { rasterize, distanceField, rectPoints, bboxOf } from '../1900/lib/labels.mjs'
import { LINE_HEIGHT } from '../1900/artwork.mjs'

// Advance widths of Libre Baskerville per character, as a fraction of the font size
// (measured in a browser from the embedded fonts).
const ADV = JSON.parse(readFileSync(new URL('./advances.json', import.meta.url), 'utf8'))
const faceOf = (kind, bold) => (kind === 'sc' ? (bold ? 'bold' : 'regular') : 'italic')
const SEA_SPACING = 2 // letter-spacing of sea names, px

export function lineWidth(line, size, kind, bold) {
  const t = kind === 'sea' ? line.toUpperCase() : line, adv = ADV[faceOf(kind, bold)]
  let w = 0
  for (const ch of t) w += adv[ch] ?? 0.6
  return w * size + (kind === 'sea' ? SEA_SPACING * (t.length - 1) : 0)
}

// Ink box of a (possibly multi-line) label centred on its anchor.
export function textBox({ text, size, kind, bold }) {
  const lines = text.split('\n')
  return { w: Math.max(...lines.map((l) => lineWidth(l, size, kind, bold))), h: size * 0.8 + (lines.length - 1) * size * LINE_HEIGHT }
}

// The name on one line, and broken between words into two or three lines.
export function layouts(name) {
  const words = name.split(' ')
  const out = [name]
  for (let i = 1; i < words.length; i++) {
    out.push(`${words.slice(0, i).join(' ')}\n${words.slice(i).join(' ')}`)
    for (let j = i + 1; j < words.length; j++) out.push(`${words.slice(0, i).join(' ')}\n${words.slice(i, j).join(' ')}\n${words.slice(j).join(' ')}`)
  }
  return out
}

// Long axis of a rasterised shape: { angle (deg, -90..90, screen y down), elongation }.
function axisOf(field, x0, y0) {
  let n = 0, mx = 0, my = 0
  for (let y = 0; y < field.h; y++) for (let x = 0; x < field.w; x++) if (field.grid[y * field.w + x]) { n++; mx += x; my += y }
  mx /= n; my /= n
  let sxx = 0, syy = 0, sxy = 0
  for (let y = 0; y < field.h; y++) for (let x = 0; x < field.w; x++) if (field.grid[y * field.w + x]) { const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy }
  const t = 0.5 * Math.atan2(2 * sxy, sxx - syy), l1 = (sxx + syy) / 2 + Math.hypot((sxx - syy) / 2, sxy), l2 = (sxx + syy) / 2 - Math.hypot((sxx - syy) / 2, sxy)
  let angle = t * 180 / Math.PI
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180
  return { angle, elongation: Math.sqrt(l1 / Math.max(l2, 1e-6)), centroid: [x0 + mx, y0 + my], cells: n }
}

export class Placer {
  constructor() { this.blocked = [] }
  block(points) { this.blocked.push(points) }
  blockCircle([x, y], r) { const pts = []; for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (dx * dx + dy * dy <= r * r) pts.push([x + dx, y + dy]); this.block(pts) }
  blockRect(at, w, h, angle, pad = 3) { const pts = rectPoints(at, w + 2 * pad, h + 2 * pad, angle); this.block(pts); return pts }
  unblock(pts) { this.blocked = this.blocked.filter((b) => b !== pts) }
  blockLine(a, b, r) { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let i = 0; i <= n; i++) this.blockCircle([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], r) }

  // region: where the label may lie. target: the point it should centre on. Returns the best
  // { text, at, angle, size, w, h } or null; the label is then blocked for later ones.
  place(region, { name, kind, bold = false, size, minSize, margin, target, scale, angles, texts, upright = false, within = Infinity }) {
    const box = bboxOf(region), [x0, y0] = box
    const field = rasterize(region, box)
    const axis = axisOf(field, x0, y0)
    for (const pts of this.blocked) for (const [x, y] of pts) {
      const gx = Math.floor(x - x0), gy = Math.floor(y - y0)
      if (gx >= 0 && gy >= 0 && gx < field.w && gy < field.h) field.grid[gy * field.w + gx] = 0
    }
    const d = distanceField(field)
    const at = (x, y) => { const gx = Math.floor(x - x0), gy = Math.floor(y - y0); return gx < 0 || gy < 0 || gx >= field.w || gy >= field.h ? 0 : d[gy * field.w + gx] }
    // Tilt along the long axis when the shape is clearly elongated; otherwise stay near upright.
    // Steeper than 45 degrees reads badly: a near-vertical shape gets a smaller upright label.
    const prefer = !upright && axis.elongation > 1.6 && Math.abs(axis.angle) <= 60 ? Math.max(-45, Math.min(45, Math.round(axis.angle / 5) * 5)) : 0
    // Tilting costs less along a clearly elongated shape.
    const tiltCost = axis.elongation > 2.2 ? 0.05 : 0.12
    const tryAngles = angles ?? (upright ? [0] : Array.from({ length: 19 }, (_, i) => -45 + i * 5).filter((a) => Math.abs(a - prefer) <= 25 || Math.abs(a) <= 10))
    const step = Math.max(2, Math.round(Math.sqrt(axis.cells) / 45))
    const fits = (x, y, w, h, angle) => {
      if (at(x, y) < h / 2 + margin) return -1
      let clear = Infinity
      for (const p of rectPoints([x, y], w, h, angle)) { const v = at(p[0], p[1]); if (v < clear) { clear = v; if (clear < margin) return -1 } }
      return clear
    }
    const score = (c, sz, angle, x, y, lines) => sz * 6 + Math.min(c - margin, 6) * 1.2 - Math.hypot(x - target[0], y - target[1]) / scale * 12 -
      (angle ? Math.abs(angle) * tiltCost + Math.abs(angle - prefer) * 0.12 : 0) - (lines - 1) * 5
    let best = null, firstFit = null
    for (let sz = size; sz >= minSize; sz--) {
      if (firstFit !== null && sz < firstFit - 2) break
      for (const text of texts ?? layouts(name)) {
        const lines = text.split('\n').length, { w, h } = textBox({ text, size: sz, kind, bold })
        for (const angle of tryAngles) {
          const consider = (x, y) => {
            if (Math.hypot(x - target[0], y - target[1]) > within) return
            const c = fits(x, y, w, h, angle); if (c < 0) return
            const s = score(c, sz, angle, x, y, lines)
            if (!best || s > best.score) best = { score: s, text, at: [x, y], angle, size: sz, w, h }
            firstFit ??= sz
          }
          for (let y = y0 + 2; y < box[3] - 2; y += step) for (let x = x0 + 2; x < box[2] - 2; x += step) consider(x, y)
        }
      }
    }
    if (!best) return null
    // Refine the position on a unit grid around the coarse best.
    const { text, angle, size: sz, w, h } = best, lines = text.split('\n').length
    for (let dy = -step; dy <= step; dy++) for (let dx = -step; dx <= step; dx++) {
      const x = best.at[0] + dx, y = best.at[1] + dy, c = fits(x, y, w, h, angle)
      if (c < 0) continue
      const s = score(c, sz, angle, x, y, lines)
      if (s > best.score) best = { ...best, score: s, at: [x, y] }
    }
    best.blocked = this.blockRect(best.at, best.w, best.h, best.angle)
    return best
  }
}
