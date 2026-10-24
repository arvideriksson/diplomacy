// Maps between this app's province ids (uppercase, e.g. "LON", "STP" + coast "nc")
// and the classical dSVG's ids (lowercase, e.g. "lon", "stp/nc").
import { parentOf } from './coasts'

// Most ids are just lowercased; a handful use different abbreviations.
import { GAME_TO_DSVG_OVERRIDES } from './idOverrides'

export { GAME_TO_DSVG_OVERRIDES }

const DSVG_TO_GAME_OVERRIDES: Record<string, string> = Object.fromEntries(
  Object.entries(GAME_TO_DSVG_OVERRIDES).map(([game, dsvg]) => [dsvg, game])
)

/** Game province id (+ optional coast) -> dSVG id. */
export const toDsvgId = (territory: string, coast?: string): string => {
  const base = GAME_TO_DSVG_OVERRIDES[territory] ?? territory.toLowerCase()
  return coast ? `${base}/${coast.toLowerCase()}` : base
}

/** dSVG id (possibly a named coast) -> game province id (coast stripped). */
export const toGameId = (dsvgId: string): string => {
  const base = parentOf(dsvgId)
  return DSVG_TO_GAME_OVERRIDES[base] ?? base.toUpperCase()
}
