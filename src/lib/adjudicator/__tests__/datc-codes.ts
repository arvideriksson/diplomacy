// Reconciliation between the TedDriggs/webDiplomacy corpus codes (lowercase) and
// our map's province keys (UPPERCASE). Across the full standard map only two
// abbreviations differ; everything else is a direct uppercase.

import type { MapDefinition } from '../../mapDefinition'

const PROVINCE_OVERRIDES: Record<string, string> = {
  lyo: 'GOL', // Gulf of Lyon
  nwy: 'NOR', // Norway
}

const NATION_CODES: Record<string, string> = {
  ENG: 'england',
  FRA: 'france',
  GER: 'germany',
  ITA: 'italy',
  AUS: 'austria',
  RUS: 'russia',
  TUR: 'turkey',
}

export const toProvince = (token: string): string =>
  PROVINCE_OVERRIDES[token.toLowerCase()] ?? token.toUpperCase()

export const toNation = (code: string): string => {
  const n = NATION_CODES[code.toUpperCase()]
  if (!n) throw new Error(`Unknown nation code: ${code}`)
  return n
}

/** Fail loudly if any province token used by the corpus maps to a non-existent key. */
export function assertCodesCoverMap(map: MapDefinition, tokens: string[]): void {
  const missing: string[] = []
  for (const tok of tokens) {
    const id = toProvince(tok)
    if (!map.territories[id]) missing.push(`${tok} -> ${id}`)
  }
  if (missing.length) {
    throw new Error(`DATC codes not covered by map: ${missing.join(', ')}`)
  }
}
