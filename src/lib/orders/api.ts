// The caller's order rows: draft autosave, submit, their own row for a round, and the
// resolved log. Writes go through the RLS-guarded RPCs; the server derives the nation.
// `client` defaults to the app's own (dev seats pass theirs).
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { rpc } from '../rpc'
import { refreshReadiness } from '../gameLive'
import type { RoundArg } from '../game'
import type { StampedOrderRow } from '../history'
import type { AnyOrder } from './types'

/**
 * Submit (or resubmit) the caller's own-nation orders for the current unresolved round
 * and mark the nation ready. There is no un-ready path: readiness clears only at
 * resolution. The server derives the nation; the round being edited is stamped so a
 * submit that races a resolution is rejected rather than landing in the next round.
 */
export async function submitOrders(gameId: string, orders: AnyOrder[], round: RoundArg, client: SupabaseClient = supabase) {
  await rpc('submit_orders', {
    p_game_id: gameId,
    p_orders: orders,
    p_ready: true,
    p_year: round.year,
    p_season: round.season,
    p_phase: round.phase,
  }, client)
  // Nothing broadcasts a ready flag any more, so pick up our own.
  refreshReadiness(gameId)
}

/**
 * Autosave the caller's UNSUBMITTED draft into their single orders row without readying.
 * Drafts and submissions share one row per (game, round, nation); readiness lives in
 * games.ready. This writes only the content, so it never broadcasts (orders isn't in
 * the realtime publication) and the adjudicator treats it as a hold until submitted.
 * Called debounced while the nation is not yet ready, so a reload never loses work. The
 * caller stamps the round it was editing; an autosave that races a resolution (and would
 * otherwise land in the next round's row) is dropped server-side.
 */
export async function saveDraftOrders(
  gameId: string,
  orders: AnyOrder[],
  round: RoundArg,
) {
  await rpc('save_draft_orders', {
    p_game_id: gameId,
    p_orders: orders,
    p_year: round.year,
    p_season: round.season,
    p_phase: round.phase,
  })
}

/**
 * The resolved-order log for a game (all nations, all past rounds). Resolved orders are
 * public, so RLS permits reading them — this is the immutable history. With `since`,
 * only rows resolved (or re-resolved after a revert) at or after that `updated_at` —
 * merge them into what's already loaded with `mergeLog`.
 */
export async function fetchResolvedLog(gameId: string, since?: string | null): Promise<StampedOrderRow[]> {
  let q = supabase
    .from('orders')
    .select('year, season, phase, nation, orders, updated_at')
    .eq('game_id', gameId)
    .eq('resolved', true)
  if (since) q = q.gte('updated_at', since)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as StampedOrderRow[]
}

/**
 * The caller's order row for a round — draft or submitted, it's the same single row
 * (RLS scopes it to their own nation while unresolved). Used to repopulate the panel on
 * load; whether it's "submitted" is read separately from games.ready.
 */
export async function fetchMyOrders(
  gameId: string,
  year: number,
  season: string,
  phase: string,
  client: SupabaseClient = supabase,
): Promise<AnyOrder[]> {
  const { data, error } = await client
    .from('orders')
    .select('orders')
    .eq('game_id', gameId)
    .eq('year', year)
    .eq('season', season)
    .eq('phase', phase)
    .eq('resolved', false)
    .maybeSingle()
  if (error) throw error
  return ((data?.orders as AnyOrder[]) ?? [])
}
