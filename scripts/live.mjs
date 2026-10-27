// The only path from this checkout to the live Supabase project. Links to the project
// named by the live backend (.env), runs ONE allowlisted command, and unlinks again in
// all cases — so at rest the repo is unlinked and `supabase config push`, `db pull`,
// etc. have no project to reach (scripts/supabase-guard.mjs blocks re-linking).
//
//   npm run live:push [-- --dry-run]       apply pending migrations
//   npm run live:deploy-functions          bundle the engine and deploy the adjudicator + notify

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveBackend } from './backend.ts'

const COMMANDS = {
  push: { args: ['db', 'push', '--linked'], extra: ['--dry-run'] },
  'deploy-functions': { args: ['functions', 'deploy', 'adjudicate', 'notify'], extra: [] },
}

const [name, ...rest] = process.argv.slice(2)
const command = COMMANDS[name]
if (!command) throw new Error(`Usage: node scripts/live.mjs <${Object.keys(COMMANDS).join('|')}> [${COMMANDS.push.extra}]`)
const bad = rest.filter((a) => !command.extra.includes(a))
if (bad.length) throw new Error(`live ${name} accepts only: ${command.extra.join(' ') || '(no flags)'}; got ${bad.join(' ')}`)

const ref = new URL(resolveBackend('live').url).hostname.split('.')[0]
const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env, DIPLOMACY_LIVE_SCRIPT: '1' }

function supabase(...args) {
  const r = spawnSync(`${root}node_modules/.bin/supabase`, args, { cwd: root, env, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`supabase ${args.join(' ')} failed`)
}

console.log(`Live project: ${ref}`)
let status = 0
try {
  supabase('link', '--project-ref', ref)
  supabase(...command.args, ...rest)
} catch (e) {
  console.error(e.message)
  status = 1
} finally {
  spawnSync(`${root}node_modules/.bin/supabase`, ['unlink'], { cwd: root, env, stdio: 'inherit' })
}
process.exit(status)
