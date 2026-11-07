// Call a Postgres RPC and throw its error, so callers don't each repeat the
// `const { error } = await supabase.rpc(...); if (error) throw error` dance. `client`
// defaults to the app's own; dev seats pass theirs.
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

export async function rpc<T = void>(
  fn: string,
  args?: Record<string, unknown>,
  client: SupabaseClient = supabase,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw error
  return data as T
}
