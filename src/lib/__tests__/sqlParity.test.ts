import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { roundRank } from '../adjudicator/fold'
import { DEFAULT_SETTINGS } from '../settings'
import { ORDER_PHASES } from '../phases'

// Rules the SQL restates from the TS side. supabase/current-functions.sql is the
// generated, CI-checked fold of every migration, so it is what the database runs.
const root = join(__dirname, '../../..')
const current = readFileSync(join(root, 'supabase/current-functions.sql'), 'utf8')

/** The body of a function's current definition. */
function fn(name: string): string {
  const start = current.indexOf(`-- ═══ public.${name}(`)
  if (start < 0) throw new Error(`no public.${name} in current-functions.sql`)
  const end = current.indexOf('-- ═══ ', start + 1)
  return current.slice(start, end < 0 ? undefined : end)
}

/** `when 'x' then N` arms of a SQL case expression, after `case <expr>`. */
function caseArms(body: string, expr: string): Record<string, number> {
  const m = new RegExp(`case\\s+${expr}\\s+([\\s\\S]*?)\\bend\\b`).exec(body)
  if (!m) throw new Error(`no case ${expr}`)
  return Object.fromEntries([...m[1].matchAll(/when\s+'(\w+)'\s+then\s+(\d+)/g)].map((a) => [a[1], Number(a[2])]))
}

describe('SQL ↔ TS parity', () => {
  it('is_order_phase lists ORDER_PHASES', () => {
    const list = /p_phase\s+in\s+\(([^)]*)\)/.exec(fn('is_order_phase'))![1]
    expect([...list.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([...ORDER_PHASES])
  })

  it('round_rank orders rounds like roundRank', () => {
    const body = fn('round_rank')
    const season = caseArms(body, 'p_season')
    const phase = caseArms(body, 'p_phase')
    const sql = (year: number, s: string, p: string) => year * 100 + (season[s] ?? 0) + (phase[p] ?? 0)
    for (const year of [1901, 1902])
      for (const s of ['Spring', 'Fall'])
        for (const p of ORDER_PHASES) expect(sql(year, s, p)).toBe(roundRank({ year, season: s as 'Spring', phase: p }))
  })

  it('phase timer and grace fallbacks are DEFAULT_SETTINGS', () => {
    const arms = /case\s+p_phase\s+when\s+'movement'\s+then\s+(\d+)\s+else\s+(\d+)\s+end/.exec(fn('phase_timer_minutes'))!
    const t = DEFAULT_SETTINGS.phase_timers
    expect(Number(arms[1])).toBe(t.movement)
    expect(t.retreat).toBe(Number(arms[2]))
    expect(t.build).toBe(Number(arms[2]))
    // Grace defaults to one movement timer, read the same way the timer is.
    expect(fn('grace_minutes')).toMatch(/phase_timer_minutes\(p_settings,\s*'movement'\)/)
  })

  it('every setting_bool default matches DEFAULT_SETTINGS', () => {
    const calls = [...current.matchAll(/setting_bool\([^,]+,\s*'(\w+)',\s*(true|false)\)/g)]
    expect(calls.length).toBeGreaterThan(0)
    const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>
    for (const [, key, def] of calls) expect([key, defaults[key] ?? false]).toEqual([key, def === 'true'])
  })

  it('the games.settings column default is DEFAULT_SETTINGS', () => {
    const dir = join(root, 'supabase/migrations')
    let latest: string | null = null
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(dir, f), 'utf8')
      for (const m of sql.matchAll(/alter\s+column\s+settings\s+set\s+default\s+'([^']*)'/gi)) latest = m[1]
    }
    expect(JSON.parse(latest!)).toEqual(DEFAULT_SETTINGS)
  })
})
