// Call a Postgres RPC and throw its error, so callers don't each repeat the
// `const { error } = await supabase.rpc(...); if (error) throw error` dance.
import { supabase } from './supabase'

export async function rpc<T = void>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
