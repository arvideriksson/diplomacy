// Compare the drawn partition with the variant's movement graph.
import { sharedEdges } from './edges.mjs'

// Adjacencies the board shows as explicit crossings rather than shared borders.
export const CROSSINGS = new Set(['cly|ire', 'den|swe'])

// The adjacency XML refers to these two seas by their judge aliases.
const ALIASES = { mao: 'mid', nao: 'nat' }

// `holes` are drawn non-province areas (unplayable islands, lakes) that may border provinces.
export function audit(provinces, xmlProvinces, { frame, minBorder = 2.5, holes = [] } = {}) {
  const wanted = new Set()
  for (const p of xmlProvinces) for (const refs of Object.values(p.edges)) for (const ref of refs) {
    const other = ALIASES[ref.split('-')[0]] ?? ref.split('-')[0]
    if (other !== p.id && p.id !== 'dum') wanted.add([p.id, other].sort().join('|'))
  }
  const { lengths, gaps, chains } = sharedEdges({ ...provinces, ...Object.fromEntries(holes.map((g, i) => [`#hole${i}`, g])) }, { frame })
  const drawn = new Set([...lengths].filter(([k, len]) => len >= minBorder && !k.includes('#')).map(([k]) => k))
  const problems = []
  const where = (k) => { const [a, b] = k.split('|'), c = chains.find((c) => c.id === a && c.other === b); return c ? ` near ${c.points[Math.floor(c.points.length / 2)].map(Math.round)}` : '' }
  for (const k of drawn) if (!wanted.has(k)) problems.push(`unexpected border ${k} (${lengths.get(k).toFixed(1)})${where(k)}`)
  for (const k of wanted) if (!drawn.has(k) && !CROSSINGS.has(k)) problems.push(`missing border ${k}${lengths.has(k) ? ` (only ${lengths.get(k).toFixed(1)})` : ''}`)
  for (const k of CROSSINGS) if (drawn.has(k)) problems.push(`crossing ${k} is also a drawn border`)
  // Unmatched boundary: hairline slivers along the board's old seams. Reported, not fatal.
  const gapLength = gaps.reduce((s, g) => s + g.len, 0)
  const warnings = gapLength > 1 ? [`unmatched boundary: ${gapLength.toFixed(1)} units, e.g. ${gaps.slice(0, 4).map((g) => `${g.id}@${g.at.map(Math.round)}`).join(' ')}`] : []
  return { problems, warnings, lengths, chains }
}
