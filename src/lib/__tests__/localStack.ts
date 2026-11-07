// Shared fixture for the *.local.test.ts suites, which run against the LOCAL Supabase
// stack (`npm run test:local`; skipped in the plain `npm test`). URL and keys come from
// scripts/backend.ts (`supabase status`), never hard-coded.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveBackend, type Backend } from '../../../scripts/backend'
import { classicalMap } from '../maps/classical'

/** Whether the local-stack suites run (LOCAL_STACK=1). */
export const RUN = !!process.env.LOCAL_STACK

let backend: Backend | null = null
/** The local stack's URL and keys. When the suites are skipped this is a placeholder,
 *  so importing a test file never needs the stack (or the CLI) to be up. */
export function local(): Backend {
  if (!RUN) return { name: 'local', url: 'http://127.0.0.1:54321', anonKey: 'skipped', vapidPublicKey: undefined }
  return (backend ??= resolveBackend('local'))
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
/** An isolated client with its own in-memory session (one per simulated player). */
export const fresh = (): SupabaseClient => createClient(local().url, local().anonKey, opts)
/** A service-role client (bypasses RLS) for setting up state no player could. */
export const service = (): SupabaseClient => createClient(local().url, local().serviceKey!, opts)

/** Classical powers, alphabetical (austria first), one per simulated player. */
export const POWERS = classicalMap.powers.map((p) => p.id).sort()

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll `cond` every 50 ms until it holds or `ms` passes; resolves to its last value. */
export async function until(cond: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(50)
  }
  return cond()
}

/** Unwrap a supabase-js result, throwing its error. */
export async function ok<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data
}


/** A classical lobby hosted by `uid` (the row createGame in lib/game.ts inserts). */
export async function newGame(c: SupabaseClient, uid: string, name: string, isPrivate: boolean): Promise<string> {
  const g = await ok(
    c.from('games')
      .insert({
        name, phase: 'lobby', year: 1901, season: 'Spring', map_id: 'classical', is_private: isPrivate, created_by: uid,
        players: { [uid]: { role: 'host', display_name: 'T0', joined_at: new Date().toISOString() } },
      })
      .select('id')
      .single(),
  )
  return (g as { id: string }).id
}

/**
 * A started seven-player classical game. `host` (usually the module-under-test's own
 * client) creates it; six fresh players join; player i holds POWERS[i].
 */
export async function startedGame(host: SupabaseClient, name: string) {
  const clients = [host, ...Array.from({ length: 6 }, fresh)]
  const ids: string[] = []
  for (const c of clients) ids.push((await ok(c.auth.signInAnonymously())).user!.id)
  const gameId = await newGame(clients[0], ids[0], name, false)
  for (const c of clients.slice(1)) await ok(c.rpc('join_public_game', { game_id: gameId }))
  for (const [i, c] of clients.entries()) await ok(c.rpc('claim_nation', { p_game_id: gameId, p_nation: POWERS[i] }))
  await ok(clients[0].rpc('start_game', { p_game_id: gameId }))
  return { gameId, clients, ids }
}
