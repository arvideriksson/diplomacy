// Tripwire for scripts/supabase-guard.mjs: the repo's `supabase` bin must be the guard,
// and the guard must refuse anything that could push local-only config to the live project.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const bin = `${root}node_modules/.bin/supabase`

function run(...args: string[]) {
  const env = { ...process.env }
  delete env.DIPLOMACY_LIVE_SCRIPT
  return spawnSync(bin, args, { cwd: root, env, encoding: 'utf8' })
}

describe('supabase CLI guard', () => {
  it('is what node_modules/.bin/supabase runs', () => {
    expect(realpathSync(bin)).toBe(realpathSync(`${root}scripts/supabase-guard.mjs`))
  })

  it.each([
    ['config', 'push'],
    ['config', 'push', '--project-ref', 'abcdefghijklmnopqrst'],
    ['--workdir', '.', 'config', 'push', '--yes'],
    ['db', 'push', '--include-seed'],
    ['link', '--project-ref', 'abcdefghijklmnopqrst'],
    ['functions', 'deploy', 'adjudicate', '--project-ref=abcdefghijklmnopqrst'],
  ])('refuses supabase %s', (...args) => {
    const r = run(...args)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Blocked')
  })

  it('passes harmless commands through to the real CLI', () => {
    const r = run('--version')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/\d+\.\d+\.\d+/)
  })
})
