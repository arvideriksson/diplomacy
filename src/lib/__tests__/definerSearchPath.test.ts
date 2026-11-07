import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 20250101000157_hardening.sql pinned search_path on every SECURITY DEFINER function
// that existed then. Anything defined later must pin its own, or a caller-controlled
// search_path could shadow what it references.
const migrationsDir = join(__dirname, '../../../supabase/migrations')
const PINNED_THROUGH = '20250101000157'

function unpinnedDefiners(): string[] {
  const bad: string[] = []
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (file.slice(0, PINNED_THROUGH.length) <= PINNED_THROUGH) continue
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    // One chunk per function: from its `create … function` to the next one.
    const starts = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)/gi)]
    starts.forEach((m, i) => {
      const chunk = sql.slice(m.index, starts[i + 1]?.index ?? sql.length)
      if (/security\s+definer/i.test(chunk) && !/set\s+search_path/i.test(chunk)) {
        bad.push(`${file}: ${m[1]}`)
      }
    })
  }
  return bad
}

describe('SECURITY DEFINER functions', () => {
  it('pin search_path in every migration after the hardening pass', () => {
    expect(unpinnedDefiners()).toEqual([])
  })
})
