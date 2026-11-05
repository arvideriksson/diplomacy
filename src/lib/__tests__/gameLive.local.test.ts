// Game pushes and the games list against the LOCAL Supabase stack (`npm run test:game`;
// skipped in the plain `npm test`; needs the local adjudicator for the resolution case).
// Covers the egress_cuts and hide_readiness migrations: nobody learns who has readied
// before the grace period (no broadcast, no readable column, no updated_at bump), a
// grace period broadcasts who it's waiting on, a resolution sends the full row without
// `ready`, only people who can see the game can join its topic, a focus re-read returns
// nothing when nothing changed, and list_games leaves out finished games the caller
// wasn't in and carries only the caller's own ready flag.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, REALTIME_SUBSCRIBE_STATES, type SupabaseClient } from '@supabase/supabase-js'

const URL_ = 'http://127.0.0.1:54321'
// The local stack's fixed demo keys (supabase status).
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const POWERS = ['austria', 'england', 'france', 'germany', 'italy', 'russia', 'turkey']
const RUN = !!process.env.LOCAL_STACK

const fresh = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

// lib/game's own client (lib/supabase reads Vite env): a fresh one, signed in below.
vi.mock('../supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabase: createClient('http://127.0.0.1:54321', ANON, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
})

const { supabase } = await import('../supabase')
const { subscribeToGame, fetchGame, fetchGameIfNewer, fetchGames, submitOrders } = await import('../game')
type GameState = import('../game').GameState

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(50)
  }
  return cond()
}

async function ok<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data
}

async function newGame(c: SupabaseClient, uid: string, name: string, isPrivate: boolean): Promise<string> {
  const g = await ok(
    c.from('games')
      .insert({
        name, phase: 'lobby', year: 1901, season: 'Spring', map_id: 'classical', is_private: isPrivate, created_by: uid,
        players: { [uid]: { role: 'host', display_name: 'T0', joined_at: new Date().toISOString() } },
      })
      .select('id')
      .single(),
  )
  return (g as { id: string }).id
}

/** Join `game:<id>` as `c` and record every Broadcast event name; resolves once the join settles. */
async function listen(c: SupabaseClient, id: string) {
  await c.realtime.setAuth()
  const events: { event: string; payload: Record<string, unknown> }[] = []
  const ch = c.channel(`game:${id}`, { config: { private: true } })
  ch.on('broadcast', { event: '*' }, (m) => events.push({ event: m.event, payload: m.payload }))
  const status = await new Promise<string>((resolve) => {
    ch.subscribe((s) => {
      if (s !== REALTIME_SUBSCRIBE_STATES.CLOSED) resolve(s)
    })
    setTimeout(() => resolve('NO_REPLY'), 8000)
  })
  return { events, status, stop: () => c.removeChannel(ch) }
}

describe.skipIf(!RUN)('game pushes and list (local stack)', () => {
  const clients: SupabaseClient[] = []
  const ids: string[] = []
  let gameId = ''

  beforeAll(async () => {
    clients.push(supabase, ...Array.from({ length: 6 }, fresh))
    for (const c of clients) ids.push((await ok(c.auth.signInAnonymously())).user!.id)
    gameId = await newGame(clients[0], ids[0], 'game push test', false)
    for (const c of clients.slice(1)) await ok(c.rpc('join_public_game', { game_id: gameId }))
    for (const [i, c] of clients.entries()) await ok(c.rpc('claim_nation', { p_game_id: gameId, p_nation: POWERS[i] }))
    await ok(clients[0].rpc('start_game', { p_game_id: gameId }))
  }, 60_000)

  it('keeps readiness secret until the grace period, then names who is left', async () => {
    const service = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
    let game: GameState | null = await fetchGame(gameId)
    const topic = subscribeToGame(gameId, () => game, (g) => (game = g))
    const raw = await listen(clients[1], gameId)
    expect(raw.status).toBe(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
    await topic.joined
    const before = (await ok(service.from('games').select('updated_at').eq('id', gameId).single())) as { updated_at: string }

    // France readies: nothing is sent, nothing moves, and nobody else can read it.
    const round = { p_year: 1901, p_season: 'Spring', p_phase: 'movement' }
    await ok(clients[2].rpc('submit_orders', { p_game_id: gameId, p_orders: [], p_ready: true, ...round }))
    await sleep(1500)
    expect(raw.events).toEqual([])
    const after = (await ok(service.from('games').select('updated_at').eq('id', gameId).single())) as { updated_at: string }
    expect(after.updated_at).toBe(before.updated_at)
    expect(game!.ready).toEqual({ austria: false })
    expect((await clients[1].from('games').select('ready').eq('id', gameId)).error).toBeTruthy()
    expect((await ok(clients[1].rpc('game_readiness', { p_game_id: gameId }))) as unknown).toEqual({
      nation: 'england', ready: false, waiting: null,
    })

    // Our own submit updates our own flag.
    await submitOrders(gameId, [], true, { year: 1901, season: 'Spring', phase: 'movement' })
    expect(await until(() => game?.ready?.austria === true)).toBe(true)
    expect(raw.events).toEqual([])

    // Past the deadline (grace period): a ready now broadcasts who's left.
    await ok(service.from('games').update({ deadline: new Date(Date.now() - 60_000).toISOString() }).eq('id', gameId))
    expect(await until(() => !!game?.waiting)).toBe(true)
    expect(game!.waiting!.sort()).toEqual(['england', 'germany', 'italy', 'russia', 'turkey'])
    await ok(clients[3].rpc('submit_orders', { p_game_id: gameId, p_orders: [], p_ready: true, ...round }))
    expect(await until(() => !game?.waiting?.includes('germany'))).toBe(true)
    const waiting = raw.events.find((e) => e.event === 'waiting')
    expect(waiting && Object.keys(waiting.payload).filter((k) => k !== 'id')).toEqual(['waiting'])

    // The rest ready: the resolution sends the full row, without `ready`.
    for (const [i, c] of clients.entries()) {
      if (i <= 3) continue
      await ok(c.rpc('submit_orders', { p_game_id: gameId, p_orders: [], p_ready: true, ...round }))
    }
    await ok(clients[1].rpc('submit_orders', { p_game_id: gameId, p_orders: [], p_ready: true, ...round }))
    expect(await until(() => game?.season === 'Fall', 60_000)).toBe(true)
    const full = raw.events.find((e) => e.event === 'game' && (e.payload as { season?: string }).season === 'Fall')
    expect(full).toBeTruthy()
    expect('ready' in full!.payload).toBe(false)
    // Realtime's own message id must not clobber the row's id.
    expect(full!.payload.id).toBe(gameId)
    expect(game!.id).toBe(gameId)
    expect(game!.ready).toEqual({ austria: false })
    expect(game!.waiting).toBeNull()

    // A focus with nothing new reads nothing back; an older cursor gets the row.
    expect(await fetchGameIfNewer(gameId, game!.updated_at)).toBeNull()
    expect((await fetchGameIfNewer(gameId, '2000-01-01T00:00:00Z'))?.id).toBe(gameId)

    topic.stop()
    raw.stop()
  }, 90_000)

  it("refuses a private game's topic to someone who isn't in it", async () => {
    const host = fresh()
    const hostId = (await ok(host.auth.signInAnonymously())).user!.id
    const privateId = await newGame(host, hostId, 'private push test', true)

    const outsider = fresh()
    await ok(outsider.auth.signInAnonymously())
    const peek = await listen(outsider, privateId)
    expect(peek.status).not.toBe(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)

    await ok(host.from('games').update({ name: 'renamed' }).eq('id', privateId))
    await sleep(1500)
    expect(peek.events).toEqual([])
    peek.stop()
  }, 30_000)

  it('lists running public games but not finished ones the caller was not in', async () => {
    const service = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
    const other = fresh()
    const otherId = (await ok(other.auth.signInAnonymously())).user!.id
    const finishedId = await newGame(other, otherId, 'finished elsewhere', false)
    await ok(service.from('games').update({ phase: 'complete' }).eq('id', finishedId))

    const list = await fetchGames()
    const listed = new Map(list.map((g) => [g.id, g]))
    expect(listed.has(finishedId)).toBe(false)
    const mine = listed.get(gameId)
    expect(mine?.me?.nation).toBe('austria')
    expect(mine?.player_count).toBe(7)
    expect(mine && 'snapshot' in mine).toBe(false)
    expect(mine && 'players' in mine).toBe(false)
    // Only the caller's own flag.
    expect(Object.keys(mine?.ready ?? {})).toEqual(['austria'])
  })

  afterAll(async () => {
    for (const c of clients) await c.removeAllChannels()
  })
})
