// Influence paint: each non-SC land province takes the colour of the power owning more than
// half of its adjacent supply centers (2 of 3 counts, 2 of 4 doesn't); otherwise it stays
// unpainted. Seas are left alone — tinting them muddies the water and hides the coast shading.
import type { MapDefinition } from '../mapDefinition'

/** Non-SC land province (game id) → the nation whose sphere of influence it is in. */
export const influencedProvinces = (
  mapDef: MapDefinition,
  ownership: Record<string, string>,
): Record<string, string> => {
  const influenced: Record<string, string> = {}
  for (const [id, territory] of Object.entries(mapDef.territories)) {
    if (territory.supplyCenter || territory.type === 'sea') continue
    const centers = territory.adjacent.filter((adj) => mapDef.territories[adj]?.supplyCenter)
    const counts = new Map<string, number>()
    for (const center of centers) {
      const owner = ownership[center]
      if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
    }
    const majority = [...counts].find(([, n]) => n * 2 > centers.length)
    if (majority) influenced[id] = majority[0]
  }
  return influenced
}
