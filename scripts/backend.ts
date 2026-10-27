// Which Supabase project a dev tool talks to — the one switch shared by the Vite dev
// server (vite.config.ts) and the Node test scripts (scripts/seven-player-game.mjs).
//
//   local — the Docker stack from `npm run db:start` (supabase/config.toml + seed.sql).
//           URL and anon key are read live from `supabase status`, so nothing to copy.
//   live  — the cloud project in .env (or VITE_* already in the environment, as in CI).
//
// Pick one with BACKEND=local|live; each caller documents its own default.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type BackendName = 'local' | 'live'

export interface Backend {
  name: BackendName
  url: string
  anonKey: string
  /** Web Push application server key; the private half lives with the notify function. */
  vapidPublicKey: string | undefined
}

// Public half of the local-only key pair in supabase/config.toml [edge_runtime.secrets].
const LOCAL_VAPID_PUBLIC_KEY =
  'BLcd0EsMMx9WnWGlZ1DAXWQsHI9EvdyVP_os99Pc8Zt5A-gJhXCJD392MGShxOYhsm5c9JtLx58zLUqqhqKmkb0'


const root = fileURLToPath(new URL('..', import.meta.url))

export function backendName(fallback: BackendName): BackendName {
  const name = process.env.BACKEND ?? fallback
  if (name !== 'local' && name !== 'live') throw new Error(`BACKEND must be "local" or "live", got "${name}"`)
  return name
}

export function resolveBackend(name: BackendName): Backend {
  return name === 'local' ? localBackend() : liveBackend()
}

function localBackend(): Backend {
  let out: string
  try {
    out = execFileSync(`${root}node_modules/.bin/supabase`, ['status', '-o', 'env'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(
      'The local Supabase stack is not running. Start it with `npm run db:start` (needs Docker), ' +
        'or target the cloud project with BACKEND=live (e.g. `npm run dev:live`).',
    )
  }
  const env = parseEnv(out)
  return { name: 'local', url: env.API_URL, anonKey: env.ANON_KEY, vapidPublicKey: LOCAL_VAPID_PUBLIC_KEY }
}

function liveBackend(): Backend {
  const file = `${root}.env`
  const env = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for the live backend (.env)')
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY ?? env.VITE_VAPID_PUBLIC_KEY
  return { name: 'live', url, anonKey, vapidPublicKey }
}

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      }),
  )
}
