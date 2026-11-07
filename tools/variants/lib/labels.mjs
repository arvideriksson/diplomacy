// Label placement for the generated boards (1900, Era of Empire).
//
// Each name is placed as near its target as it fits, at the largest size that fits, on one line
// or broken over two or three, upright or tilted (along the province's long axis, or the
// caller's preferred angle). For each label the region is rasterised, symbols and labels
// already placed are blocked out, and a distance field gives every candidate box's clearance.
//
// Text widths come from `advances.json`: the glyph advances of the embedded Libre Baskerville
// (regular, bold, italic), measured in a browser by `measure-advances.mjs`.
import { readFileSync } from 'node:fs'
import { LINE_HEIGHT } from '../1900/artwork.mjs'

// --- Text metrics. ---

// Advance width per character, as a fraction of the font size, by face.
const ADV = JSON.parse(readFileSync(new URL('./advances.json', import.meta.url), 'utf8'))
// Label kinds as the boards draw them: sc upright (regular or bold), land italic, sea italic caps.
const faceOf = (kind, bold) => (kind === 'sc' ? (bold ? 'bold' : 'regular') : 'italic')
const SEA_SPACING = 2 // letter-spacing of sea names, px

// Width of one line of text in a face, with `spacing` px of letter-spacing between characters.
export const advance = (line, size, face, spacing = 0) => {
  const adv = ADV[face]
  let w = 0
  for (const ch of line) w += adv[ch] ?? 0.6
  return w * size + spacing * ([...line].length - 1)
}

export function lineWidth(line, size, kind, bold) {
  const t = kind === 'sea' ? line.toUpperCase() : line
  return advance(t, size, faceOf(kind, bold), kind === 'sea' ? SEA_SPACING : 0)
}

// Ink box of a (possibly multi-line) label centred on its anchor.
export function textBox({ text, size, kind, bold }) {
  const lines = text.split('\n')
  return { w: Math.max(...lines.map((l) => lineWidth(l, size, kind, bold))), h: size * 0.8 + (lines.length - 1) * size * LINE_HEIGHT }
}

// Ink box of a label group's markup as drawn (e.g. a label kept from the classical board, set
// with text-anchor start, x/y offsets, per-tspan sizes and letter-spacing): { at, w, h } in
// board units for a group at `at` rotated by `angle`, `at` being the box centre.
export function markupBox(inner, at, angle = 0) {
  const props = (tag) => {
    const a = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
    for (const [, k, v] of (a.style ?? '').matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) a[k] = v.trim()
    return a
  }
  const textTag = inner.match(/<text\b([^>]*)>/)[1], base = props(textTag)
  const spans = [...inner.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>/g)].map((m) => [{ ...base, ...props(m[1]) }, m[2]])
  if (!spans.length) spans.push([base, inner.replace(/<[^>]+>/g, '')])
  const num = (v, d = 0) => (v === undefined || v === 'normal' ? d : parseFloat(v))
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [p, t] of spans) {
    const size = num(p['font-size'], 16), face = p['font-style'] === 'italic' ? 'italic' : /bold|[6-9]00/.test(p['font-weight'] ?? '') ? 'bold' : 'regular'
    const w = advance(t, size, face, num(p['letter-spacing'])), x = num(p.x)
    // dominant-baseline central puts y at the text's centre; otherwise y is the baseline.
    const cy = /central|middle/.test(p['dominant-baseline'] ?? '') ? num(p.y) : num(p.y) - 0.35 * size
    const left = /middle/.test(p['text-anchor'] ?? '') ? x - w / 2 : /end/.test(p['text-anchor'] ?? '') ? x - w : x
    x0 = Math.min(x0, left); x1 = Math.max(x1, left + w); y0 = Math.min(y0, cy - 0.4 * size); y1 = Math.max(y1, cy + 0.4 * size)
  }
  const a = angle * Math.PI / 180, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  return { at: [at[0] + cx * Math.cos(a) - cy * Math.sin(a), at[1] + cx * Math.sin(a) + cy * Math.cos(a)], w: x1 - x0, h: y1 - y0 }
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

// --- Raster primitives. ---

export const bboxOf = (g) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of g) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [Math.floor(x0) - 2, Math.floor(y0) - 2, Math.ceil(x1) + 2, Math.ceil(y1) + 2]
}

export function rasterize(g, [x0, y0, x1, y1]) {
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
export function distanceField({ grid, w, h }) {
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
export const rectPoints = ([cx, cy], w, h, deg) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), pts = []
  const nx = Math.max(2, Math.ceil(w / 3)), ny = Math.max(2, Math.ceil(h / 3))
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    const u = (i / nx - 0.5) * w, v = (j / ny - 0.5) * h
    pts.push([cx + u * c - v * s, cy + u * s + v * c])
  }
  return pts
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

// --- The placer. ---

export class Placer {
  constructor() { this.blocked = [] }
  block(points) { this.blocked.push(points) }
  blockCircle([x, y], r) { const pts = []; for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (dx * dx + dy * dy <= r * r) pts.push([x + dx, y + dy]); this.block(pts) }
  blockRect(at, w, h, angle, pad = 3) { const pts = rectPoints(at, w + 2 * pad, h + 2 * pad, angle); this.block(pts); return pts }
  unblock(pts) { this.blocked = this.blocked.filter((b) => b !== pts) }
  blockLine(a, b, r) { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let i = 0; i <= n; i++) this.blockCircle([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], r) }

  // region: where the label may lie. target: the point it should centre on; `scale` is the
  // distance (board units) that costs as much as 2 font sizes. prefer: a hand-chosen angle to
  // lean towards; without it, the shape's own angle (below). Every angle, upright included,
  // costs its distance from that. Returns the best
  // { text, at, angle, size, w, h } or null; the label is then blocked for later ones.
  place(region, { name, kind, bold = false, size, minSize, margin, target, scale, angles, texts, upright = false, within = Infinity, prefer: hand }) {
    const box = bboxOf(region), [x0, y0] = box
    const field = rasterize(region, box)
    const axis = axisOf(field, x0, y0)
    // Half the shape's thickness: its largest inscribed circle, before symbols are blocked out.
    const inradius = distanceField(field).reduce((m, v) => Math.max(m, v), 0)
    for (const pts of this.blocked) for (const [x, y] of pts) {
      const gx = Math.floor(x - x0), gy = Math.floor(y - y0)
      if (gx >= 0 && gy >= 0 && gx < field.w && gy < field.h) field.grid[gy * field.w + gx] = 0
    }
    const d = distanceField(field)
    const at = (x, y) => { const gx = Math.floor(x - x0), gy = Math.floor(y - y0); return gx < 0 || gy < 0 || gx >= field.w || gy >= field.h ? 0 : d[gy * field.w + gx] }
    // The shape's own angle. A name follows its province only when the province reads as a band
    // the name runs along, as on the classical board (Prussia, the Adriatic):
    //  - clearly elongated (long:short at least 2.4), so the axis is what the eye sees, not an
    //    artefact of a lobe (Chungking, Vladivostok stay upright);
    //  - the name spans much of the band (elongation x name length / thickness at least 1.5), so
    //    a short name in a roomy province stays upright (Moscow, Bokhara);
    //  - tilted 15 to 70 degrees (the name stops at 60): a smaller tilt looks accidental;
    //  - no hand-picked angle list: one means the layout has already chosen.
    // A band's name then takes the full axis, never a compromise between it and
    // upright, and upright costs its distance from it like any other angle. Any other name is
    // upright for free and tilts only when that fits it better (towards the axis, if any).
    const fill = textBox({ text: name, size, kind, bold }).w / Math.max(2 * inradius, 1)
    const band = !upright && !angles && axis.elongation >= 2.4 && axis.elongation * fill >= 1.5 && Math.abs(axis.angle) >= 15 && Math.abs(axis.angle) <= 70
    // A band keeps its whole axis (to 60 degrees: the Red Sea runs at about 58); the older
    // lean of other elongated shapes stops at 45.
    const axisAngle = Math.max(band ? -60 : -45, Math.min(band ? 60 : 45, Math.round(axis.angle / 5) * 5))
    const prefer = hand ?? (band || (!upright && axis.elongation > 1.6 && Math.abs(axis.angle) <= 60) ? axisAngle : 0)
    const tiltCost = band && hand === undefined ? 0.02 : axis.elongation > 2.2 ? 0.05 : 0.12
    const uprightFree = hand === undefined && !band
    const tryAngles = angles ?? (upright ? [0] : Array.from({ length: 25 }, (_, i) => -60 + i * 5).filter((a) => Math.abs(a) <= 45 || band).filter((a) => Math.abs(a - prefer) <= 25 || Math.abs(a) <= 10))
    const step = Math.max(2, Math.round(Math.sqrt(axis.cells) / 45))
    const fits = (x, y, w, h, angle) => {
      if (at(x, y) < h / 2 + margin) return -1
      let clear = Infinity
      for (const p of rectPoints([x, y], w, h, angle)) { const v = at(p[0], p[1]); if (v < clear) { clear = v; if (clear < margin) return -1 } }
      return clear
    }
    const score = (c, sz, angle, x, y, lines) => sz * 6 + Math.min(c - margin, 6) * 1.2 - Math.hypot(x - target[0], y - target[1]) / scale * 12 -
      (angle || !uprightFree ? Math.abs(angle) * tiltCost + Math.abs(angle - prefer) * 0.12 : 0) - (lines - 1) * 5
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
