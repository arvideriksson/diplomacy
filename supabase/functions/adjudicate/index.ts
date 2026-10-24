// Authoritative adjudicator Edge Function. Invoked by pg_cron via pg_net with a
// shared-secret bearer token and { game_id }. It is the only writer of resolved
// state; the actual rules live in the pure engine under src/lib/adjudicator.

import { clearResolving, serviceClient } from './db.ts'
import { resolveGame, revertGame, type RoundKey } from './resolve.ts'

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

  // { game_id } resolves the current round; { game_id, action: 'revert', target } rolls
  // the game back to an earlier round (requested by the host via host_revert_to).
  let gameId: string
  let action: string | undefined
  let target: RoundKey | undefined
  try {
    const body = await req.json()
    gameId = body.game_id
    action = body.action
    target = body.target
  } catch {
    return new Response('bad request', { status: 400 })
  }
  if (!gameId) return new Response('missing game_id', { status: 400 })

  const db = serviceClient()
  try {
    const out = action === 'revert'
      ? await revertGame(db, gameId, target!)
      : await resolveGame(db, gameId)
    return Response.json(out)
  } catch (e) {
    // Release the lock so the next tick retries this game exactly once.
    await clearResolving(db, gameId).catch(() => {})
    console.error('adjudicate failed', gameId, e)
    return new Response(`error: ${e}`, { status: 500 })
  }
})
