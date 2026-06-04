import { writable } from 'svelte/store'
import { supabase } from './supabase'
import { getMap } from './maps'
import type { Unit } from './types'
import type { AnyOrder } from './orders/types'
import type { ResolvedOrderRow } from './history'

export type { Unit }

export interface GameSettings {
  turn_timer: '12h' | '24h' | '48h' | '72h' | '1w'
  variant: 'standard' | 'gunboat'
  allow_spectators: boolean
  random_nations: boolean
}

export const DEFAULT_SETTINGS: GameSettings = {
  turn_timer: '24h',
  variant: 'standard',
  allow_spectators: true,
  random_nations: false,
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
  units: Unit[]
  settings: GameSettings
  is_private: boolean
  invite_code: string | null
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

export const NATIONS = [
  'England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey',
] as const

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

export async function createGame(name: string, userId: string, isPrivate: boolean = true, mapId: string = 'standard') {
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
      year: 1901,
      season: 'Spring',
      map_id: mapId,
      players: { [userId]: playerInfo },
      units: [],
      settings: DEFAULT_SETTINGS,
      is_private: isPrivate,
      created_by: userId,
    })
    .select()
    .single()

  if (error) throw error
  return data as GameState
}

export async function updateGame(id: string, updates: Partial<Pick<GameState, 'name' | 'settings' | 'is_private' | 'phase' | 'players' | 'year' | 'season' | 'units' | 'deadline'>>) {
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

/** The initial unit placement for a map variant, as game-state units. */
export function startingUnits(mapId: string): Unit[] {
  return getMap(mapId).startingUnits.map((u) => ({
    type: u.type,
    nation: u.power,
    territory: u.territory,
    coast: u.coast,
  }))
}

/** How long each phase lasts before the cron backstop auto-resolves it. */
const TURN_TIMER_MS: Record<string, number> = {
  '12h': 12 * 3600_000,
  '24h': 24 * 3600_000,
  '48h': 48 * 3600_000,
  '72h': 72 * 3600_000,
  '1w': 7 * 24 * 3600_000,
}

/** ISO deadline one turn-timer from now (the cron's backstop trigger). */
export function nextDeadline(turnTimer: string): string {
  const ms = TURN_TIMER_MS[turnTimer] ?? TURN_TIMER_MS['24h']
  return new Date(Date.now() + ms).toISOString()
}

/** Fisher–Yates shuffle (app-side; not the deterministic engine). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Resolve final nation assignments at start. Random mode assigns everyone a fresh
 * distinct power; otherwise players keep the power they claimed in the lobby and any
 * who didn't pick are filled from the remaining free powers at random.
 */
export function assignNations(
  players: Record<string, PlayerInfo>,
  powerIds: string[],
  random: boolean,
): Record<string, PlayerInfo> {
  const uids = Object.keys(players)
  const next: Record<string, PlayerInfo> = {}

  if (random) {
    const pool = shuffle(powerIds)
    uids.forEach((uid, i) => (next[uid] = { ...players[uid], nation: pool[i] }))
    return next
  }

  // Keep claimed powers; random-fill players who never picked from what's left.
  const taken = new Set(uids.map((u) => players[u].nation).filter(Boolean) as string[])
  const free = shuffle(powerIds.filter((id) => !taken.has(id)))
  let fi = 0
  for (const uid of uids) {
    next[uid] = { ...players[uid], nation: players[uid].nation ?? free[fi++] }
  }
  return next
}

/** Claim a power in the lobby (atomic, server-checked). Pass null to release. */
export async function claimNation(gameId: string, nation: string | null) {
  const { error } = await supabase.rpc('claim_nation', { p_game_id: gameId, p_nation: nation })
  if (error) throw error
}

/**
 * Move a game from lobby to active play: assign nations to the players, stamp the
 * opening Spring 1901 movement phase, seed the board with the map's starting units,
 * and set the first deadline so the cron backstop resolves the turn even if not
 * everyone readies. Powers with no human player simply hold (civil disorder).
 */
export async function startGame(game: GameState) {
  const mapId = game.map_id ?? 'standard'
  const map = getMap(mapId)
  const powerIds = map.powers.map((p) => p.id)
  if (Object.keys(game.players).length > powerIds.length) {
    throw new Error(`Too many players for ${map.name} (max ${powerIds.length})`)
  }
  return updateGame(game.id, {
    phase: 'movement',
    year: 1901,
    season: 'Spring',
    units: startingUnits(mapId),
    deadline: nextDeadline(game.settings?.turn_timer ?? '24h'),
    players: assignNations(game.players, powerIds, game.settings?.random_nations ?? false),
  })
}

export async function joinGameByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_game_by_code', { code })
  if (error) throw error
  return data as string
}

export async function joinGame(gameId: string) {
  const { error } = await supabase.rpc('join_public_game', { game_id: gameId })
  if (error) throw error
  return fetchGame(gameId)
}

export async function leaveGame(gameId: string) {
  const { error } = await supabase.rpc('leave_game', { game_id: gameId })
  if (error) throw error
}

export async function kickPlayer(gameId: string, playerId: string) {
  const { error } = await supabase.rpc('kick_player', { game_id: gameId, player_id: playerId })
  if (error) throw error
}

/**
 * Submit (upsert) the caller's own-nation orders for the current unresolved round
 * via the RLS-guarded RPC, optionally marking the nation ready. Editing orders
 * un-readies the nation unless `ready` is true. The server derives the nation and
 * round, so the client cannot write another nation's or a resolved round's orders.
 */
export async function submitOrders(gameId: string, orders: AnyOrder[], ready: boolean = false) {
  const { error } = await supabase.rpc('submit_orders', {
    p_game_id: gameId,
    p_orders: orders,
    p_ready: ready,
  })
  if (error) throw error
}

/** Toggle the nation's ready flag without resubmitting orders. */
export async function setReady(gameId: string, ready: boolean) {
  const { error } = await supabase.rpc('set_ready', { p_game_id: gameId, p_ready: ready })
  if (error) throw error
}

/**
 * Autosave the caller's UNSUBMITTED draft into their single orders row without readying.
 * Drafts and submissions share one row per (game, round, nation); readiness lives in
 * games.ready. This writes only the content, so it never broadcasts (orders isn't in
 * the realtime publication) and the adjudicator treats it as a hold until submitted.
 * Called debounced while the nation is not yet ready, so a reload never loses work.
 */
export async function saveDraftOrders(gameId: string, orders: AnyOrder[]) {
  const { error } = await supabase.rpc('save_draft_orders', { p_game_id: gameId, p_orders: orders })
  if (error) throw error
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
  const { data, error } = await supabase.rpc('admin_delete_all_games')
  if (error) throw error
  return data as number
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
