/**
 * Dev-only multi-player harness: up to seven anonymous "seats", each a separate Supabase
 * session persisted under its own storage key (see devAuthOptions in ./supabase). One tab
 * hops between seats with switchSeat (a reload under the other key), and the helpers below
 * drive the *other* seats' sessions directly so a lobby can be filled or a round readied
 * without ever opening another tab. Every path goes through the normal RLS-guarded RPCs as
 * that seat's own auth.uid — nothing here is privileged.
 *
 * Only import behind `import.meta.env.DEV`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  activeDevSeat,
  devSeatStorageKey,
  DEV_SEAT_COUNT,
} from './supabase'
import { getMap } from './maps'
import type { GameState } from './game'

export const SEATS = Array.from({ length: DEV_SEAT_COUNT }, (_, i) => i + 1)

export interface SeatUser {
  id: string
  name: string
}

/** The user a seat is signed in as, read straight from its persisted session (no network). */
export function seatUser(seat: number): SeatUser | null {
  try {
    const raw = localStorage.getItem(devSeatStorageKey(seat))
    const user = raw ? JSON.parse(raw)?.user : null
    if (!user?.id) return null
    const meta = user.user_metadata ?? {}
    return { id: user.id, name: meta.full_name ?? meta.name ?? user.email ?? `Seat ${seat}` }
  } catch {
    return null
  }
}

const clients = new Map<number, SupabaseClient>()

/** A client bound to a seat's session. The active seat reuses the app's own client. */
function seatClient(seat: number): SupabaseClient {
  if (seat === activeDevSeat()) return supabase
  let client = clients.get(seat)
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: window.localStorage,
        storageKey: devSeatStorageKey(seat),
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    clients.set(seat, client)
  }
  return client
}

/** Sign a seat in anonymously if it has no session yet; returns its user id. */
async function ensureSeat(seat: number): Promise<string> {
  const client = seatClient(seat)
  const { data } = await client.auth.getSession()
  if (data.session) return data.session.user.id
  const name = `Seat ${seat}`
  const { data: signedIn, error } = await client.auth.signInAnonymously({
    options: { data: { full_name: name, name } },
  })
  if (error) throw error
  return signedIn.user!.id
}

/** Make `seat` this tab's identity (signing it in first if empty) and reload under it. */
export async function switchSeat(seat: number) {
  await ensureSeat(seat)
  sessionStorage.setItem('dev-seat', String(seat))
  location.reload()
}

/** Which seat holds a given user id, if any. */
export function seatOf(userId: string): number | null {
  return SEATS.find((s) => seatUser(s)?.id === userId) ?? null
}

/**
 * Fill a lobby to seven players with dev seats: each seat not yet in the game signs in
 * (if needed), joins, and claims the first free power in map order. Seats already in the
 * game without a power claim one too, so every seat maps to a nation before start.
 */
export async function fillLobby(game: GameState): Promise<void> {
  const powers = getMap(game.map_id).powers.map((p) => p.id)
  const taken = new Set(Object.values(game.players).map((p) => p.nation).filter(Boolean))
  let count = Object.keys(game.players).length

  for (const seat of SEATS) {
    const known = seatUser(seat)
    const inGame = known ? game.players[known.id] : undefined
    if (inGame?.nation) continue
    if (!inGame && count >= powers.length) continue

    const client = seatClient(seat)
    const id = await ensureSeat(seat)
    if (!game.players[id]) {
      const { error } = await client.rpc('join_public_game', { game_id: game.id })
      if (error) throw new Error(`Seat ${seat} join: ${error.message}`)
      count++
    }
    const nation = powers.find((p) => !taken.has(p))
    if (!nation) continue
    const { error } = await client.rpc('claim_nation', { p_game_id: game.id, p_nation: nation })
    if (error) throw new Error(`Seat ${seat} claim ${nation}: ${error.message}`)
    taken.add(nation)
  }
}

/**
 * Submit every other seat's current draft (or nothing — i.e. hold) and mark it ready, so
 * the active seat is the last one out. With early resolution on, the active seat's own
 * submit then resolves the round. Returns the nations it readied.
 */
export async function readyOtherSeats(game: GameState): Promise<string[]> {
  const round = { p_year: game.year, p_season: game.season, p_phase: game.phase }
  const readied: string[] = []
  for (const seat of SEATS) {
    if (seat === activeDevSeat()) continue
    const known = seatUser(seat)
    const nation = known ? game.players[known.id]?.nation : undefined
    if (!nation || game.ready?.[nation]) continue

    const client = seatClient(seat)
    const { data: row, error: readErr } = await client
      .from('orders')
      .select('orders')
      .eq('game_id', game.id)
      .eq('year', game.year)
      .eq('season', game.season)
      .eq('phase', game.phase)
      .eq('resolved', false)
      .maybeSingle()
    if (readErr) throw new Error(`Seat ${seat} read: ${readErr.message}`)

    const { error } = await client.rpc('submit_orders', {
      p_game_id: game.id,
      p_orders: row?.orders ?? [],
      p_ready: true,
      ...round,
    })
    if (error) throw new Error(`Seat ${seat} (${nation}) submit: ${error.message}`)
    readied.push(nation)
  }
  return readied
}
