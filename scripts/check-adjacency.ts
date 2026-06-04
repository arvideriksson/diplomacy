import { standardMap } from '../src/lib/maps/standard.ts'

const T = standardMap.territories
const ids = Object.keys(T)

// Effective fleet neighbors of a province: province-level fleetAdjacent, OR the
// union of its coasts' fleetAdjacency (split-coast provinces define it per-coast).
function fleetNeighbors(id: string): string[] {
  const t = T[id] as any
  if (t.type === 'sea') return t.adjacent ?? []   // seas: adjacent IS the fleet graph
  if (t.coasts) {
    const s = new Set<string>()
    for (const c of Object.values<any>(t.coasts)) for (const n of c.fleetAdjacency) s.add(n)
    return [...s]
  }
  return t.fleetAdjacent ?? []
}

let problems = 0
const log = (m: string) => { console.log(m); problems++ }

// 1. Every referenced id must exist.
for (const id of ids) {
  const t = T[id] as any
  const refs = new Set<string>([...(t.adjacent ?? []), ...fleetNeighbors(id)])
  for (const n of refs) if (!T[n]) log(`MISSING: ${id} references unknown ${n}`)
}

// 2. Army/general adjacency must be symmetric.
for (const id of ids) {
  for (const n of (T[id] as any).adjacent ?? []) {
    if (!T[n]) continue
    if (!((T[n] as any).adjacent ?? []).includes(id))
      log(`ASYM adjacent: ${id}->${n} but not ${n}->${id}`)
  }
}

// 3. Fleet adjacency must be symmetric (using effective neighbors that fold coasts).
for (const id of ids) {
  for (const n of fleetNeighbors(id)) {
    if (!T[n]) continue
    if (!fleetNeighbors(n).includes(id))
      log(`ASYM fleet: ${id}->${n} but not ${n}->${id}`)
  }
}

// 4. fleetAdjacent must be a subset of adjacent (a fleet move is also a general edge).
for (const id of ids) {
  const adj = new Set((T[id] as any).adjacent ?? [])
  for (const n of fleetNeighbors(id))
    if (!adj.has(n)) log(`fleet not in adjacent: ${id} fleet->${n} missing from adjacent`)
}

// 5. Sea zones: adjacent and fleet neighbors should match (no land-only edges).
for (const id of ids) {
  if ((T[id] as any).type !== 'sea') continue
  const adj = [...((T[id] as any).adjacent ?? [])].sort().join(',')
  const fl = [...fleetNeighbors(id)].sort().join(',')
  if (adj !== fl) log(`SEA mismatch ${id}: adjacent=[${adj}] fleet=[${fl}]`)
}

console.log(problems === 0 ? '\n✅ internal consistency: all checks pass' : `\n❌ ${problems} problem(s)`)
console.log(`\n${ids.length} territories, ${ids.filter(i => (T[i] as any).supplyCenter).length} supply centers`)
