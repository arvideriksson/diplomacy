import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { maps } from './index'

// public.maps (supabase/migrations/*_maps_table.sql and later) duplicates each map's power
// list and starting year for start_game / join_public_game. Fold every
// `insert into public.maps` seed in migration order and compare with the TS registry.
const migrationsDir = join(__dirname, '../../../supabase/migrations')

function sqlSeed(): Record<string, { powers: string[]; startingYear: number }> {
  const seed: Record<string, { powers: string[]; startingYear: number }> = {}
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    for (const insert of sql.match(/insert\s+into\s+public\.maps\b[\s\S]*?;/gi) ?? []) {
      const row = /\(\s*'([^']+)'\s*,\s*array\[([^\]]*)\]\s*,\s*(\d+)\s*\)/g
      for (const [, id, powers, year] of insert.matchAll(row)) {
        seed[id] = {
          powers: [...powers.matchAll(/'([^']+)'/g)].map((m) => m[1]),
          startingYear: Number(year),
        }
      }
    }
  }
  return seed
}

describe('public.maps SQL seed', () => {
  const seed = sqlSeed()

  it('has a row for every registered map and no others', () => {
    expect(Object.keys(seed).sort()).toEqual(Object.keys(maps).sort())
  })

  it.each(Object.entries(maps))('%s matches its MapDefinition', (id, def) => {
    expect(seed[id]).toEqual({
      powers: def.powers.map((p) => p.id),
      startingYear: def.startingYear ?? 1901,
    })
  })
})
