import { writable } from 'svelte/store'
import { supabase } from './supabase'
import { rpc } from './rpc'
import { metaDisplayName } from './auth'
import { getMap } from './maps'
import type { Unit } from './types'
import type { AnyOrder } from './orders/types'
import type { StampedOrderRow } from './history'
import type { RoundKey, Season } from './adjudicator/types'
import type { GamePhase, Phase } from './phases'

export type { Unit, RoundKey }

/**
 * A round as the order/revert RPCs take it. Looser than RoundKey because some callers
 * still hold season/phase as plain strings; the server validates both.
 */
export type RoundArg = Omit<RoundKey, 'season' | 'phase'> & { season: string; phase: string }

/** Per-phase auto-resolve durations, in minutes. */
export interface PhaseTimers {
  movement: number
  retreat: number
  build: number
}

export type OrderPhase = Phase

export interface GameSettings {
  /** No press: players cannot send chat / negotiate. The map is chosen via `map_id`. */
  gunboat: boolean
  random_nations: boolean
  /** Resolve as soon as every power has submitted, rather than only at the deadline. */
  early_resolution: boolean
  /** How long each phase lasts before its deadline (minutes); unready powers then get a grace period. */
  phase_timers: PhaseTimers
  /**
   * The creator gets an in-game admin menu (revert, force-resolve, deadline and pacing
   * changes). Private games only; editable in the lobby, fixed once the game starts.
   */
  host_controls?: boolean
  /**
   * How long (minutes) a phase waits past its deadline for unsubmitted powers before
   * resolving without them (0 = no grace). Absent/null = one movement timer.
   */
  grace_period?: number | null
  /** Length (minutes) of the game's first phase, for opening negotiations. Absent/null = the movement timer. */
  first_turn?: number | null
  /** Legacy single-timer enum; read only as a fallback when phase_timers is absent. */
  turn_timer?: '12h' | '24h' | '48h' | '72h' | '1w'
}

export const DEFAULT_SETTINGS: GameSettings = {
  gunboat: false,
  random_nations: false,
  early_resolution: true,
  phase_timers: { movement: 1440, retreat: 720, build: 720 }, // 24h / 12h / 12h
}

export interface GameState {
  id: string
  name: string
  phase: GamePhase
  year: number
  season: Season
  /** Key into the map registry (see src/lib/maps/index.ts). */
  map_id: string
  players: Record<string, PlayerInfo>
  settings: GameSettings
  is_private: boolean
  created_by: string
  created_at: string
  updated_at: string
  /** When the current phase auto-resolves (ISO). Null in the lobby / once complete. */
  deadline?: string | null
  /** When the grace period after `deadline` runs out (ISO); kept server-side from settings. */
  grace_ends_at?: string | null
  /** Authoritative board snapshot written by the adjudicator; clients read this. */
  snapshot?: unknown | null
  /** How the game ended by agreement (a tie or a win by concession); null otherwise. */
  result?: GameResult | null
  /** Per-nation early-resolution flags, e.g. { france: true }. */
  ready?: Record<string, boolean>
}

/** A game ended by the players' votes (see the draw_votes migration). */
export interface GameResult {
  kind: 'draw' | 'concession'
  /** The powers sharing the result (one for a concession). */
  nations: string[]
  year: number
  season: string
  phase: string
}

export interface PlayerInfo {
  role: 'host' | 'player'
  nation?: string
  display_name?: string
  joined_at: string
}

export const games = writable<GameState[]>([])
export const currentGame = writable<GameState | null>(null)
/** False until the first fetchGames resolves — gates the "no games yet" empty state. */
export const gamesLoaded = writable(false)

export async function fetchGames() {
  try {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) throw error
    games.set(data ?? [])
    return data
  } finally {
    gamesLoaded.set(true)
  }
}

export async function fetchGame(id: string) {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  currentGame.set(data)
  return data as GameState
}

/** Run a game-mutating RPC, then refetch the game (also refreshing `currentGame`). */
async function rpcThenFetch(gameId: string, fn: string, args: Record<string, unknown>): Promise<GameState> {
  await rpc(fn, args)
  return fetchGame(gameId)
}

export async function createGame(name: string, userId: string, isPrivate: boolean = true, mapId: string = 'classical') {
  const map = getMap(mapId)
  const { data: userData } = await supabase.auth.getUser()
  const meta = userData?.user?.user_metadata ?? {}

  const playerInfo: PlayerInfo = {
    role: 'host',
    display_name: metaDisplayName(meta),
    joined_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('games')
    .insert({
      name,
      phase: 'lobby',
      year: map.startingYear ?? 1901,
      season: 'Spring',
      map_id: mapId,
      players: { [userId]: playerInfo },
      settings: DEFAULT_SETTINGS,
      is_private: isPrivate,
      created_by: userId,
    })
    .select()
    .single()

  if (error) throw error
  return data as GameState
}

/**
 * Direct update of the creator-editable columns. RLS + column grants allow only these;
 * is_private / map_id / settings are further locked to the lobby by a trigger.
 */
export async function updateGame(id: string, updates: Partial<Pick<GameState, 'name' | 'settings' | 'is_private' | 'map_id'>>) {
  const { data, error } = await supabase
    .from('games')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  currentGame.set(data)
  return data as GameState
}

/**
 * Update game settings through the guarded RPC (creator-only; mid-game edits are
 * host-controlled-games-only and limited to mutable keys). Merges into existing settings
 * server-side. Use this instead of a raw games update so the rules are enforced.
 */
export async function updateGameSettings(gameId: string, settings: Partial<GameSettings>) {
  return rpcThenFetch(gameId, 'update_game_settings', { p_game_id: gameId, p_settings: settings })
}

/**
 * Override the current phase deadline (creator-only, host-controlled games only). Pass an
 * ISO string to set it, or null to clear (no backstop until the next resolution).
 */
export async function setDeadline(gameId: string, deadline: string | null) {
  return rpcThenFetch(gameId, 'set_deadline', { p_game_id: gameId, p_deadline: deadline })
}

/**
 * Resolve the current phase right now (host controls), ending any grace period:
 * nations that haven't submitted hold. The board arrives via the Realtime push.
 */
export async function forceResolve(gameId: string) {
  await rpc('host_force_resolve', { p_game_id: gameId })
}

/**
 * Roll the game back to the start of an earlier phase (host controls). Every later
 * phase is erased and that phase's orders reopen as unsubmitted drafts. Like a
 * resolution, the new board arrives via the Realtime push.
 */
export async function revertTo(gameId: string, round: RoundArg) {
  await rpc('host_revert_to', {
    p_game_id: gameId,
    p_year: round.year,
    p_season: round.season,
    p_phase: round.phase,
  })
}

/** Claim a power in the lobby (atomic, server-checked). Pass null to release. */
export async function claimNation(gameId: string, nation: string | null) {
  await rpc('claim_nation', { p_game_id: gameId, p_nation: nation })
}

/**
 * Move a game from lobby to active play (creator-only, server-side): the start_game RPC
 * assigns nations, stamps the opening Spring movement phase and sets the first deadline.
 * The snapshot stays null until the first resolution — it reads as the map's opening
 * position. Powers with no human player simply hold (civil disorder).
 */
export async function startGame(game: GameState) {
  return rpcThenFetch(game.id, 'start_game', { p_game_id: game.id })
}

export async function joinGame(gameId: string) {
  return rpcThenFetch(gameId, 'join_public_game', { game_id: gameId })
}

export async function leaveGame(gameId: string) {
  await rpc('leave_game', { game_id: gameId })
}

export async function kickPlayer(gameId: string, playerId: string) {
  await rpc('kick_player', { game_id: gameId, player_id: playerId })
}

/**
 * Submit (upsert) the caller's own-nation orders for the current unresolved round
 * via the RLS-guarded RPC, optionally marking the nation ready. Editing orders
 * un-readies the nation unless `ready` is true. The server derives the nation; the
 * caller stamps the round it was editing so a submit that races a resolution is
 * rejected rather than landing in the next round's row.
 */
export async function submitOrders(
  gameId: string,
  orders: AnyOrder[],
  ready: boolean = false,
  round?: RoundArg,
) {
  await rpc('submit_orders', {
    p_game_id: gameId,
    p_orders: orders,
    p_ready: ready,
    p_year: round?.year ?? null,
    p_season: round?.season ?? null,
    p_phase: round?.phase ?? null,
  })
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
): Promise<AnyOrder[]> {
  const { data, error } = await supabase
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

export async function adminDeleteAllGames(): Promise<number> {
  return rpc<number>('admin_delete_all_games')
}

export function subscribeToGame(id: string, callback: (game: GameState) => void) {
  return supabase
    .channel(`game:${id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` },
      (payload) => {
        const game = payload.new as GameState
        currentGame.set(game)
        callback(game)
      }
    )
    .subscribe()
}
