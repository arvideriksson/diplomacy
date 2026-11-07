// Game pushes and the games list against the LOCAL Supabase stack (`npm run test:game`;
// skipped in the plain `npm test`; needs the local adjudicator for the resolution case).
// Covers the egress_cuts and hide_readiness migrations: nobody learns who has readied
// before the grace period (no broadcast, no readable column, no updated_at bump), a
// grace period broadcasts who it's waiting on, a resolution sends the full row without
// `ready`, only people who can see the game can join its topic, a focus re-read returns
// nothing when nothing changed, and list_games leaves out finished games the caller
// wasn't in and carries only the caller's own ready flag.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { REALTIME_SUBSCRIBE_STATES, type SupabaseClient } from '@supabase/supabase-js'
import { RUN, fresh, newGame, ok, POWERS, service as serviceClient, sleep, startedGame, until } from './localStack'

// The module's own client (lib/supabase reads Vite env): a fresh one, signed in below.
vi.mock('../supabase', async () => ({ supabase: (await import('./localStack')).fresh() }))

const { supabase } = await import('../supabase')
const { fetchGame, fetchGameIfNewer, fetchGames } = await import('../game')
const { subscribeToGame } = await import('../gameLive')
const { submitOrders } = await import('../orders/api')
type GameState = import('../game').GameState

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
    const g = await startedGame(supabase, 'game push test')
    clients.push(...g.clients)
    ids.push(...g.ids)
    gameId = g.gameId
  }, 60_000)

  it('keeps readiness secret until the grace period, then names who is left', async () => {
    const service = serviceClient()
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
    await submitOrders(gameId, [], { year: 1901, season: 'Spring', phase: 'movement' })
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
    const service = serviceClient()
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
