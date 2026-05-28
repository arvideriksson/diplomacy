import { writable } from 'svelte/store'
import { supabase } from './supabase'

export interface GameState {
  id: string
  name: string
  phase: string
  year: number
  season: 'Spring' | 'Fall'
  players: Record<string, string>
  units: Unit[]
  is_private: boolean
  invite_code: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Unit {
  type: 'army' | 'fleet'
  nation: string
  territory: string
}

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
  return data
}

export async function createGame(name: string, userId: string, isPrivate: boolean = false) {
  const { data, error } = await supabase
    .from('games')
    .insert({
      name,
      phase: 'lobby',
      year: 1901,
      season: 'Spring',
      players: { [userId]: 'host' },
      units: [],
      is_private: isPrivate,
      created_by: userId,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function joinGameByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_game_by_code', { code })
  if (error) throw error
  return data as string
}

export function subscribeToGame(id: string, callback: (game: GameState) => void) {
  return supabase
    .channel(`game:${id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` },
      (payload) => {
        callback(payload.new as GameState)
      }
    )
    .subscribe()
}
