// Shared by the adjudicate and notify functions: the shared-secret gate and the
// service-role client. (`_shared/` is Supabase's convention for code imported by
// several functions; it is bundled into each at deploy and is not a function itself.)

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

/**
 * Both functions are reached only from Postgres (pg_net, via private.engine_config) with
 * `Authorization: Bearer <ADJUDICATOR_SECRET>` — a dedicated secret (config has
 * verify_jwt = false), decoupled from the API keys so it survives key rotation. Returns a
 * 403 to send back, or null when the caller is authorised. Fails closed when unset.
 */
export function rejectUnauthorised(req: Request): Response | null {
  const expected = Deno.env.get('ADJUDICATOR_SECRET')
  if (!expected || req.headers.get('Authorization') !== `Bearer ${expected}`) {
    return new Response('forbidden', { status: 403 })
  }
  return null
}

/** A service-role client: bypasses RLS. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
 *  injected by the Edge runtime. */
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}
