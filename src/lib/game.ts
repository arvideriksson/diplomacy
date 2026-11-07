import { get, writable } from 'svelte/store'
import { supabase } from './supabase'
import { rpc } from './rpc'
import { metaDisplayName } from './auth'
import { getMap } from './maps'
import type { Unit } from './types'
import type { RoundKey, Season } from './adjudicator/types'
import { isOrderPhase, type GamePhase, type Phase } from './phases'

export type { Unit, RoundKey }

/**
 * A round as the order/revert RPCs take it. Looser than RoundKey because some callers
 * still hold season/phase as plain strings; the server validates both.
 */
export type RoundArg = Omit<RoundKey, 'season' | 'phase'> & { season: string; phase: string }

export { DEFAULT_SETTINGS, type GameSettings, type OrderPhase, type PhaseTimers } from './settings'
import { DEFAULT_SETTINGS, type GameSettings } from './settings'

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
  /** The viewer's own ready flag, keyed by their nation ({ england: true }). Players
   *  can't read anyone else's: the column is hidden (migration 154) and this is filled
   *  in from game_readiness. Empty for spectators. */
  ready?: Record<string, boolean>
  /** During a grace period, the powers the phase is still waiting on; null otherwise. */
  waiting?: string[] | null
}

/** Every games column a player may read: all but `ready` (see migration 154). */
const GAME_COLUMNS =
  'id, name, phase, year, season, players, created_by, created_at, updated_at, is_private, settings, map_id, deadline, snapshot, resolving_at, grace_ends_at, result'

interface Readiness {
  nation: string | null
  ready: boolean | null
  waiting: string[] | null
}

/** The viewer's own flag, and who's left during a grace period. */
export async function fetchReadiness(id: string): Promise<Readiness | null> {
  return rpc<Readiness | null>('game_readiness', { p_game_id: id })
}

/** fetchReadiness, with a failed read as `undefined` (null means "no readiness to show"). */
export const tryReadiness = (id: string): Promise<Readiness | null | undefined> =>
  fetchReadiness(id).catch(() => undefined)

/**
 * Merge a readiness read into a game row. A failed read (`undefined`) keeps the
 * readiness already shown for that same round rather than wiping the viewer's flag.
 */
export function withReadiness(g: GameState, r: Readiness | null | undefined): GameState {
  if (r === undefined) {
    const prev = get(currentGame)
    const sameRound = prev?.id === g.id && prev.year === g.year && prev.season === g.season && prev.phase === g.phase
    return { ...g, ready: sameRound ? prev.ready : {}, waiting: sameRound ? prev.waiting : null }
  }
  return {
    ...g,
    ready: r?.nation && r.ready != null ? { [r.nation]: r.ready } : {},
    waiting: r?.waiting ?? null,
  }
}

/** The game row with the viewer's readiness merged in. */
export async function readGame(id: string, since?: string): Promise<GameState | null> {
  let q = supabase.from('games').select(GAME_COLUMNS).eq('id', id)
  if (since) q = q.gt('updated_at', since)
  const [{ data, error }, readiness] = await Promise.all([q.limit(1), tryReadiness(id)])
  if (error) throw error
  const row = (data?.[0] ?? null) as GameState | null
  return row && withReadiness(row, readiness)
}

/** A game ended by the players' votes (see the draw_votes migration). */
export interface GameResult {
  /** draw / concession: by the players' votes; victory: on supply centers (from
   *  migration 159 — older finished games have no result and are read off the board). */
  kind: 'draw' | 'concession' | 'victory'
  /** The powers sharing the result (one for a concession or a solo). */
  nations: string[]
  /** victory only: the winner's supply-center count. */
  centers?: number
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

/**
 * Whether press is closed: from the deadline until the phase resolves (the grace period)
 * no message can be sent. Mirrors press_closed() in 20250101000150_press_closed_in_grace.sql,
 * which is what actually enforces it.
 */
export function pressClosed(game: { phase: string; deadline?: string | null }, now = Date.now()): boolean {
  return isOrderPhase(game.phase) && !!game.deadline && Date.parse(game.deadline) <= now
}

/**
 * A row of the games list (`list_games()`): just what the list shows — no board
 * snapshot or settings, and the viewer's own player entry (`me`) instead of everyone's.
 */
export type GameListItem = Pick<
  GameState,
  'id' | 'name' | 'phase' | 'year' | 'season' | 'map_id' | 'is_private' | 'created_by' | 'updated_at' | 'deadline' | 'grace_ends_at' | 'ready'
> & {
  player_count: number
  // `ready` holds only the viewer's own nation here (migration 153): the list never
  // reveals who else has readied.
  /** The viewer's entry in `players`, or null if they aren't in the game. */
  me: PlayerInfo | null
  /** How a game ended by agreement (null for a solo or an unfinished game). Absent from
   *  servers before migration 153. */
  result?: GameResult | null
  /** Final supply-center ownership, for complete games only — the client derives a solo
   *  winner from it with victoryFor. Absent from servers before migration 153. */
  final_centers?: Record<string, string> | null
}

export const games = writable<GameListItem[]>([])
export const currentGame = writable<GameState | null>(null)
/** False until the first fetchGames resolves — gates the "no games yet" empty state. */
export const gamesLoaded = writable(false)

export async function fetchGames() {
  try {
    // The viewer's games plus the public ones still open or running (RLS + list_games).
    const data = (await rpc<GameListItem[] | null>('list_games')) ?? []
    games.set(data)
    return data
  } finally {
    gamesLoaded.set(true)
  }
}

export async function fetchGame(id: string) {
  const game = await readGame(id)
  if (!game) throw new Error('Game not found')
  currentGame.set(game)
  return game
}

/** The game row if it changed after `since` (its `updated_at`), else null — a check
 *  that costs a few hundred bytes when nothing happened instead of the whole row. */
export async function fetchGameIfNewer(id: string, since: string): Promise<GameState | null> {
  const game = await readGame(id, since)
  if (game) currentGame.set(game)
  return game
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
    .select(GAME_COLUMNS)
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
    .select(GAME_COLUMNS)
    .single()

  if (error) throw error
  const game = withReadiness(data as GameState, await tryReadiness(id))
  currentGame.set(game)
  return game
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

/** Delete a game that hasn't started (host only; see delete_lobby_game). */
export async function deleteLobbyGame(gameId: string) {
  await rpc('delete_lobby_game', { p_game_id: gameId })
}

export async function kickPlayer(gameId: string, playerId: string) {
  await rpc('kick_player', { game_id: gameId, player_id: playerId })
}

export async function adminDeleteAllGames(): Promise<number> {
  return rpc<number>('admin_delete_all_games')
}
