// The only path from this checkout to the live Supabase project. Links to the project
// named by the live backend (.env), runs ONE allowlisted command, and unlinks again in
// all cases — so at rest the repo is unlinked and `supabase config push`, `db pull`,
// etc. have no project to reach (scripts/supabase-guard.mjs blocks re-linking).
//
//   npm run live:push [-- --dry-run]       apply pending migrations
//   npm run live:deploy-functions          bundle the engine and deploy the adjudicator + notify
//   npm run live:diagnose-push             read-only: push subscriptions + recent notify replies
//   npm run live:ping-notify               database → notify call that sends nothing (health check)
//   npm run live:secrets-list              read-only: secret names + SHA-256 digests (no values)
//   npm run live:functions-list            read-only: deployed Edge Functions
//   npm run live:secrets                   set the Edge Function secrets in .env.functions.local
//                                          (gitignored; e.g. the VAPID keys notify signs pushes with)
//   npm run live:rotate-adjudicator-secret new random ADJUDICATOR_SECRET, written to both the
//                                          function secrets and private.engine_config; never printed
//
// Secret commands run OUTSIDE the repo: `supabase secrets set` also uploads every secret in
// the working directory's supabase/config.toml [edge_runtime.secrets] — the local dev ones.
// From an empty temp dir (naming the project with --project-ref) only the given ones go up.

import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBackend } from './backend.ts'

const COMMANDS = {
  push: { args: ['db', 'push', '--linked'], extra: ['--dry-run'] },
  'deploy-functions': { args: ['functions', 'deploy', 'adjudicate', 'notify'], extra: [] },
  'diagnose-push': { args: ['db', 'query', '--linked', '--file', 'scripts/diagnostics/push.sql'], extra: [] },
  'ping-notify': { args: ['db', 'query', '--linked', '--file', 'scripts/diagnostics/ping-notify.sql'], extra: [] },
  'secrets-list': { outside: ['secrets', 'list'], extra: [] },
  'functions-list': { outside: ['functions', 'list'], extra: [] },
  secrets: { outside: () => ['secrets', 'set', '--env-file', `${root}.env.functions.local`], extra: [] },
  'rotate-adjudicator-secret': { run: rotateAdjudicatorSecret, extra: [] },
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
  if (r.status !== 0) throw new Error(`supabase ${args[0]} ${args[1] ?? ''} failed`)
}

// A command run from an empty directory, so no supabase/config.toml is read.
function outside(...args) {
  const dir = mkdtempSync(join(tmpdir(), 'diplomacy-live-'))
  try {
    const r = spawnSync(`${root}node_modules/.bin/supabase`, [...args, '--project-ref', ref], { cwd: dir, env, stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`supabase ${args[0]} ${args[1] ?? ''} failed`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The cron/RPC → Edge Function shared secret lives in two places that must agree.
function rotateAdjudicatorSecret() {
  const secret = randomBytes(32).toString('base64url')
  supabase('db', 'query', '--linked', `update private.engine_config set service_key = '${secret}' where id`)
  outside('secrets', 'set', `ADJUDICATOR_SECRET=${secret}`)
  console.log(`ADJUDICATOR_SECRET rotated; sha256 ${createHash('sha256').update(secret).digest('hex')}`)
}

console.log(`Live project: ${ref}`)
let status = 0
try {
  if (command.outside) {
    outside(...(typeof command.outside === 'function' ? command.outside() : command.outside), ...rest)
  } else {
    supabase('link', '--project-ref', ref)
    if (command.run) command.run()
    else supabase(...command.args, ...rest)
  }
} catch (e) {
  console.error(e.message)
  status = 1
} finally {
  if (!command.outside) spawnSync(`${root}node_modules/.bin/supabase`, ['unlink'], { cwd: root, env, stdio: 'inherit' })
}
process.exit(status)
