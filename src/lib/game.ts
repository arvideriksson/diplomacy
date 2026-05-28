import { writable } from 'svelte/store'
import { supabase } from './supabase'

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
  players: Record<string, PlayerInfo>
  units: Unit[]
  settings: GameSettings
  is_private: boolean
  invite_code: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface PlayerInfo {
  role: 'host' | 'player'
  nation?: string
  display_name?: string
  avatar_url?: string
  joined_at: string
}

export interface Unit {
  type: 'army' | 'fleet'
  nation: string
  territory: string
}

export const NATIONS = [
  'England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey',
] as const

export const games = writable<GameState[]>([])
export const currentGame = writable<GameState | null>(null)

export async function fetchGames() {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw error
  games.set(data ?? [])
  return data
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

export async function createGame(name: string, userId: string, isPrivate: boolean = false) {
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

export async function updateGame(id: string, updates: Partial<Pick<GameState, 'name' | 'settings' | 'is_private' | 'phase' | 'players'>>) {
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
