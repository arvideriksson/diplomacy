// Service-role database access for the adjudicator. The service key bypasses RLS;
// this function is the only writer of resolved state.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface GameRow {
  id: string
  map_id: string
  year: number
  season: 'Spring' | 'Fall'
  phase: string
  snapshot: unknown | null
  resolving_at: string | null
  ready: Record<string, boolean> | null
}

export interface LogRow {
  year: number
  season: string
  phase: string
  nation: string
  orders: unknown[]
}

export interface OrderRow {
  nation: string
  orders: unknown[]
}

export async function getGame(db: SupabaseClient, gameId: string): Promise<GameRow | null> {
  const { data, error } = await db.from('games').select('*').eq('id', gameId).maybeSingle()
  // A real database error must throw, so index.ts releases the claim and the next tick
  // retries; only a genuinely missing row is "not found".
  if (error) throw error
  return (data as GameRow | null) ?? null
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

/** Every resolved order row for a game — the replay log. */
export async function getResolvedLog(db: SupabaseClient, gameId: string): Promise<LogRow[]> {
  const { data, error } = await db
    .from('orders')
    .select('year, season, phase, nation, orders')
    .eq('game_id', gameId)
    .eq('resolved', true)
  if (error) throw error
  return (data ?? []) as LogRow[]
}

export async function clearResolving(db: SupabaseClient, gameId: string): Promise<void> {
  await db.from('games').update({ resolving_at: null }).eq('id', gameId)
}
