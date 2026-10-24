import { writable } from 'svelte/store'
import { supabase, rpc } from './supabase'
import { getMap } from './maps'
import type { Unit } from './types'
import type { AnyOrder } from './orders/types'
import type { ResolvedOrderRow } from './history'

export type { Unit }

/** Per-phase auto-resolve durations, in minutes. */
export interface PhaseTimers {
  movement: number
  retreat: number
  build: number
}

export type OrderPhase = keyof PhaseTimers

export interface GameSettings {
  /** No press: players cannot send chat / negotiate. The map is chosen via `map_id`. */
  gunboat: boolean
  allow_spectators: boolean
  random_nations: boolean
  /** Resolve as soon as every power has submitted, rather than only at the deadline. */
  early_resolution: boolean
  /** How long each phase lasts before the cron backstop auto-resolves it (minutes). */
  phase_timers: PhaseTimers
  /** Legacy single-timer enum; read only as a fallback when phase_timers is absent. */
  turn_timer?: '12h' | '24h' | '48h' | '72h' | '1w'
}

export const DEFAULT_SETTINGS: GameSettings = {
  gunboat: false,
  allow_spectators: true,
  random_nations: false,
  early_resolution: true,
  phase_timers: { movement: 1440, retreat: 720, build: 720 }, // 24h / 12h / 12h
}

export interface GameState {
  id: string
  name: string
  phase: string
  year: number
  season: 'Spring' | 'Fall'
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
  /** Authoritative board snapshot written by the adjudicator; clients read this. */
  snapshot?: unknown | null
  /** Per-nation early-resolution flags, e.g. { france: true }. */
  ready?: Record<string, boolean>
}

export interface PlayerInfo {
  role: 'host' | 'player'
  nation?: string
  display_name?: string
  avatar_url?: string
  joined_at: string
}

export const games = writable<GameState[]>([])
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
  return data as GameState
}

export async function createGame(name: string, userId: string, isPrivate: boolean = true, mapId: string = 'classical') {
  const map = getMap(mapId)
  const { data: userData } = await supabase.auth.getUser()
  const meta = userData?.user?.user_metadata ?? {}

  const playerInfo: PlayerInfo = {
    role: 'host',
    display_name: meta.full_name ?? meta.name ?? undefined,
    avatar_url: meta.avatar_url ?? undefined,
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
  return data as GameState
}

/**
 * Update game settings through the guarded RPC (creator-only; mid-game edits are
 * private-games-only and limited to mutable keys). Merges into existing settings
 * server-side. Use this instead of a raw games update so the rules are enforced.
 */
export async function updateGameSettings(gameId: string, settings: Partial<GameSettings>) {
  await rpc('update_game_settings', {
    p_game_id: gameId,
    p_settings: settings,
  })
  return fetchGame(gameId)
}

/**
 * Override the current phase deadline (creator-only, private games only). Pass an
 * ISO string to set it, or null to clear (no backstop until the next resolution).
 */
export async function setDeadline(gameId: string, deadline: string | null) {
  await rpc('set_deadline', {
    p_game_id: gameId,
    p_deadline: deadline,
  })
  return fetchGame(gameId)
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
  await rpc('start_game', { p_game_id: game.id })
  return fetchGame(game.id)
}

export async function joinGame(gameId: string) {
  await rpc('join_public_game', { game_id: gameId })
  return fetchGame(gameId)
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
  round?: { year: number; season: string; phase: string },
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
  round: { year: number; season: string; phase: string },
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
 * The full resolved-order log for a game (all nations, all past rounds). Resolved
 * orders are public, so RLS permits reading them — this is the immutable history.
 */
export async function fetchResolvedLog(gameId: string): Promise<ResolvedOrderRow[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('year, season, phase, nation, orders')
    .eq('game_id', gameId)
    .eq('resolved', true)
  if (error) throw error
  return (data ?? []) as ResolvedOrderRow[]
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
        callback(game)
      }
    )
    .subscribe()
}
