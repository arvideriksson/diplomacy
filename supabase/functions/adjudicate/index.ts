// Authoritative adjudicator Edge Function. Invoked by pg_cron via pg_net with a
// shared-secret bearer token and { game_id }. It is the only writer of resolved
// state; the actual rules live in the pure engine under src/lib/adjudicator.

import { clearResolving, serviceClient } from './db.ts'
import { resolveGame } from './resolve.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  // Gate on a DEDICATED shared secret (config has verify_jwt = false), set via
  // `supabase secrets set ADJUDICATOR_SECRET=…` and mirrored in private.engine_config.
  // Decoupled from Supabase's anon/service_role keys, so this survives API-key
  // rotation/migration. Fail closed if the secret isn't configured.
  const expected = Deno.env.get('ADJUDICATOR_SECRET')
  const auth = req.headers.get('Authorization') ?? ''
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('forbidden', { status: 403 })
  }

  let gameId: string
  try {
    gameId = (await req.json()).game_id
  } catch {
    return new Response('bad request', { status: 400 })
  }
  if (!gameId) return new Response('missing game_id', { status: 400 })

  const db = serviceClient()
  try {
    const out = await resolveGame(db, gameId, Date.now())
    return Response.json(out)
  } catch (e) {
    // Release the lock so the next tick retries this game exactly once.
    await clearResolving(db, gameId).catch(() => {})
    console.error('adjudicate failed', gameId, e)
    return new Response(`error: ${e}`, { status: 500 })
  }
})
