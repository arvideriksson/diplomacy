#!/usr/bin/env node
// The repo's `supabase` command. postinstall (scripts/install-supabase-guard.mjs) points
// node_modules/.bin/supabase here, so npm scripts and `npx supabase` both pass through
// this check before reaching the real CLI.
//
// supabase/config.toml and seed.sql describe ONLY the local stack, so anything that
// could carry them to the live project is refused outright. The checkout is also kept
// unlinked: linking (or naming a project with --project-ref) is allowed only from
// scripts/live.mjs, which links, runs one allowlisted command, and unlinks again.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const words = args.filter((a) => !a.startsWith('-'))
const viaLiveScript = process.env.DIPLOMACY_LIVE_SCRIPT === '1'

function refuse(why) {
  console.error(`\n✖ supabase ${args.join(' ')}\n  Blocked: ${why}\n`)
  process.exit(1)
}

if (words.includes('config') && words.includes('push'))
  refuse('supabase/config.toml configures only the local stack; pushing it would overwrite live settings. Change live settings in the dashboard.')
if (words[0] === 'secrets' && words[1] === 'set' && existsSync('supabase/config.toml'))
  refuse('`secrets set` also uploads supabase/config.toml [edge_runtime.secrets] — the local dev secrets. Use `npm run live:secrets`, which runs it outside the repo.')
if (args.includes('--include-seed'))
  refuse('supabase/seed.sql is local-only wiring and must never reach the live database.')
if (!viaLiveScript && words[0] === 'link')
  refuse('this checkout stays unlinked so nothing targets the live project by accident. Use `npm run live:push` or `npm run live:deploy-functions`.')
if (!viaLiveScript && args.some((a) => a === '--project-ref' || a.startsWith('--project-ref=')))
  refuse('only scripts/live.mjs may target a remote project. Use `npm run live:push` or `npm run live:deploy-functions`.')

const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url))
const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' })
process.exit(result.status ?? 1)
