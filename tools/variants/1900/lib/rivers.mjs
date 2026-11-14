// River centerlines (Natural Earth 10m rivers + its European supplement, the few the 1900
// board follows), for borders drawn along real rivers.
import { readFileSync } from 'node:fs'

let rivers
const features = () => (rivers ??= JSON.parse(readFileSync(new URL('../../../geodata/src/rivers.geojson', import.meta.url), 'utf8')).features)

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

// The course along the named rivers (their lines mapped through `f`) between the vertices
// nearest `from` and `to`: a shortest path over the river network, where line ends within
// 2 units of another vertex count as joined.
export function riverCourse(names, from, to, f) {
  const lines = features().filter((x) => names.includes(x.properties.name)).flatMap((x) => x.geometry.coordinates.map((l) => l.map(f)))
  const V = [], ids = new Map(), adj = [], ends = []
  const vertex = (p) => { const k = p[0].toFixed(2) + ',' + p[1].toFixed(2); if (!ids.has(k)) { ids.set(k, V.length); V.push(p); adj.push([]) } return ids.get(k) }
  const link = (a, b) => { const w = dist(V[a], V[b]); adj[a].push([b, w]); adj[b].push([a, w]) }
  for (const l of lines) {
    let prev = null
    for (const p of l) { const i = vertex(p); if (prev !== null && prev !== i) link(prev, i); prev = i }
    ends.push(vertex(l[0]), vertex(l.at(-1)))
  }
  for (const e of ends) V.forEach((q, j) => { if (j !== e && dist(V[e], q) < 2) link(e, j) })
  const nearest = (p) => V.reduce((b, q, i) => (dist(q, p) < dist(V[b], p) ? i : b), 0)
  const s = nearest(from), t = nearest(to)
  const d = new Array(V.length).fill(Infinity), prev = new Array(V.length).fill(-1), open = new Set([s])
  d[s] = 0
  while (open.size) {
    let u = null
    for (const q of open) if (u === null || d[q] < d[u]) u = q
    open.delete(u)
    if (u === t) break
    for (const [v, w] of adj[u]) if (d[u] + w < d[v]) { d[v] = d[u] + w; prev[v] = u; open.add(v) }
  }
  if (d[t] === Infinity) throw new Error(`No course along ${names.join('/')} from ${from} to ${to}`)
  const path = []
  for (let u = t; u !== -1; u = prev[u]) path.push(V[u])
  return path.reverse()
}
