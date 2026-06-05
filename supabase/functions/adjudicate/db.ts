// Service-role database access for the adjudicator. The service key bypasses RLS;
// this function is the only writer of resolved state.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface GameRow {
  id: string
  map_id: string
  year: number
  season: 'Spring' | 'Fall'
  phase: string
  snapshot: unknown | null
  resolving_at: string | null
  settings: { turn_timer?: string; phase_timers?: Record<string, number> } | null
  ready: Record<string, boolean> | null
}

export interface OrderRow {
  nation: string
  orders: unknown[]
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function getGame(db: SupabaseClient, gameId: string): Promise<GameRow | null> {
  const { data, error } = await db.from('games').select('*').eq('id', gameId).single()
  if (error) return null
  return data as GameRow
}

export async function getRoundOrders(
  db: SupabaseClient,
  gameId: string,
  year: number,
  season: string,
  phase: string,
): Promise<OrderRow[]> {
  const { data, error } = await db
    .from('orders')
    .select('nation, orders')
    .eq('game_id', gameId)
    .eq('year', year)
    .eq('season', season)
    .eq('phase', phase)
    .eq('resolved', false)
  if (error) throw error
  return (data ?? []) as OrderRow[]
}

export async function clearResolving(db: SupabaseClient, gameId: string): Promise<void> {
  await db.from('games').update({ resolving_at: null }).eq('id', gameId)
}
