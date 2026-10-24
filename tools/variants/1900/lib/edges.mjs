// Recover the shared boundaries of a province partition. Every ring segment is
// matched to the neighbouring province whose boundary it lies on; consecutive
// segments with the same neighbour become one polyline. Segments with no
// neighbour lie on the board frame or reveal a gap in the partition. Each chain records
// its ring (`ring`, with `poly` and `hole` locating it in its province), in ring order.
import { segDist } from './geom.mjs'

const CELL = 8

export function sharedEdges(provinces, { tolerance = 0.08, frame } = {}) {
  const segs = []
  const rings = []
  for (const [id, g] of Object.entries(provinces)) for (const [pi, pl] of g.entries()) for (const [ri, r] of pl.entries()) {
    const ring = r.at(-1)[0] === r[0][0] && r.at(-1)[1] === r[0][1] ? r.slice(0, -1) : r
    const base = segs.length
    for (let i = 0; i < ring.length; i++) segs.push({ id, a: ring[i], b: ring[(i + 1) % ring.length] })
    rings.push({ id, base, n: ring.length, poly: pi, hole: ri > 0 })
  }
  const grid = new Map()
  segs.forEach((s, k) => {
    for (let x = Math.floor(Math.min(s.a[0], s.b[0]) / CELL); x <= Math.floor(Math.max(s.a[0], s.b[0]) / CELL); x++)
      for (let y = Math.floor(Math.min(s.a[1], s.b[1]) / CELL); y <= Math.floor(Math.max(s.a[1], s.b[1]) / CELL); y++) {
        const key = `${x},${y}`; (grid.get(key) ?? grid.set(key, []).get(key)).push(k)
      }
  })
  const onFrame = (p) => frame && (Math.abs(p[0] - frame[0]) < 0.5 || Math.abs(p[1] - frame[1]) < 0.5 || Math.abs(p[0] - frame[2]) < 0.5 || Math.abs(p[1] - frame[3]) < 0.5)
  for (const s of segs) {
    const m = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]
    let best = tolerance, who = null
    const cx = Math.floor(m[0] / CELL), cy = Math.floor(m[1] / CELL)
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (const k of grid.get(`${x},${y}`) ?? []) {
      const o = segs[k]; if (o.id === s.id) continue
      const d = segDist(m, o.a, o.b); if (d < best) { best = d; who = o.id }
    }
    s.other = who ?? (onFrame(m) && onFrame(s.a) && onFrame(s.b) ? '#frame' : null)
  }
  const chains = [], lengths = new Map(), gaps = []
  for (const [ringIndex, { id, base, n, poly, hole }] of rings.entries()) {
    // Start each walk at a neighbour change so chains do not wrap mid-run.
    let start = 0
    for (let i = 0; i < n; i++) if (segs[base + i].other !== segs[base + (i + n - 1) % n].other) { start = i; break }
    let cur = null
    for (let k = 0; k < n; k++) {
      const s = segs[base + (start + k) % n]
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])
      if (s.other === null) gaps.push({ id, at: s.a, len })
      if (s.other && s.other !== '#frame') { const key = [id, s.other].sort().join('|'); lengths.set(key, (lengths.get(key) ?? 0) + len / 2) }
      if (!cur || cur.other !== s.other) { cur = { id, other: s.other, points: [s.a], ring: ringIndex, poly, hole }; chains.push(cur) }
      cur.points.push(s.b)
    }
  }
  return { chains, lengths, gaps }
}
