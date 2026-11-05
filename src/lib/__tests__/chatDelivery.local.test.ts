// Press delivery against the LOCAL Supabase stack (`npm run test:chat`; skipped in the
// plain `npm test`). Drives the real chat store as one player while another sends, and
// covers the gaps that made press feel unreliable:
//   • the first message of a brand-new conversation landing before the receiver's
//     topic has joined (it used to show no badge and no live message);
//   • the server closing a topic when its access token expires (live press used to die
//     until a remount);
//   • mark_chat_read moving the cursor only up to what was on screen.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { get } from 'svelte/store'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL_ = 'http://127.0.0.1:54321'
// The local stack's fixed demo keys (supabase status).
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const POWERS = ['austria', 'england', 'france', 'germany', 'italy', 'russia', 'turkey']
const RUN = !!process.env.CHAT_LOCAL

const fresh = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

// The store's own client (lib/supabase reads Vite env): a fresh one, signed in below.
vi.mock('../supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabase: createClient('http://127.0.0.1:54321', ANON, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
})

const { supabase } = await import('../supabase')
const { createChatStore } = await import('../chatStore')
const { chatOverview, markRead } = await import('../chat')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 6000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(50)
  }
  return cond()
}

function mint(sub: string, secs: number) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = b64({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + secs })
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`
}

async function ok<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data
}

describe.skipIf(!RUN)('press delivery (local stack)', () => {
  let gameId = ''
  let me = { id: '', nation: 'england' }
  let sender: SupabaseClient
  /** In the game, but not in the conversations the tests open (Germany). */
  let bystander: SupabaseClient
  let store: ReturnType<typeof createChatStore>

  beforeAll(async () => {
    const clients = [supabase, ...Array.from({ length: 6 }, fresh)]
    const ids: string[] = []
    for (const c of clients) ids.push((await ok(c.auth.signInAnonymously())).user!.id)
    const game = await ok(
      clients[0]
        .from('games')
        .insert({
          name: 'chat delivery test', phase: 'lobby', year: 1901, season: 'Spring', map_id: 'classical',
          players: { [ids[0]]: { role: 'host', display_name: 'T0', joined_at: new Date().toISOString() } },
          is_private: false, created_by: ids[0],
        })
        .select('id')
        .single(),
    )
    gameId = (game as { id: string }).id
    for (const c of clients.slice(1)) await ok(c.rpc('join_public_game', { game_id: gameId }))
    for (const [i, c] of clients.entries()) await ok(c.rpc('claim_nation', { p_game_id: gameId, p_nation: POWERS[i] }))
    await ok(clients[0].rpc('start_game', { p_game_id: gameId }))
    me = { id: ids[0], nation: POWERS[0] }
    sender = clients[1]
    bystander = clients[3]

    store = createChatStore(gameId, me.nation, async () => {}, () => false)
    await store.load()
  }, 60_000)

  afterAll(() => store?.destroy())

  it('shows the first message of a conversation started by someone else', async () => {
    for (let trial = 0; trial < 5; trial++) {
      const c = await ok(sender.rpc('create_named_channel', { p_game_id: gameId, p_members: [me.nation], p_name: `t${trial}` }))
      const id = (c as { id: number }).id
      await ok(sender.rpc('send_chat_message', { p_channel_id: id, p_body: 'hello' }))
      const seen = await until(() => get(store.unread)[id] === 1 && get(store.latest)[id]?.body === 'hello')
      expect(seen, `trial ${trial}: unread=${get(store.unread)[id]} preview=${get(store.latest)[id]?.body}`).toBe(true)
    }
  }, 60_000)

  it('keeps receiving after the server closes its topics for an expired token', async () => {
    const c = await ok(sender.rpc('get_or_create_channel', { p_game_id: gameId, p_members: [me.nation] }))
    const id = (c as { id: number }).id
    await store.openChannel(id) // a loaded thread: live messages land in it
    await ok(sender.rpc('send_chat_message', { p_channel_id: id, p_body: 'before' }))
    expect(await until(() => get(store.messagesByCh)[id]?.some((m) => m.body === 'before'))).toBe(true)

    // What a phone suspended past its token's lifetime comes back to: the topics joined
    // with a token that expires, and the server closes them.
    await supabase.realtime.setAuth(mint(me.id, 3))
    await sleep(8000)

    await ok(sender.rpc('send_chat_message', { p_channel_id: id, p_body: 'after' }))
    const got = await until(() => !!get(store.messagesByCh)[id]?.some((m) => m.body === 'after'), 15_000)
    expect(got).toBe(true)
  }, 60_000)

  it('marks read only up to the message shown', async () => {
    const c = await ok(sender.rpc('get_or_create_channel', { p_game_id: gameId, p_members: [me.nation, POWERS[2]] }))
    const id = (c as { id: number }).id
    const first = (await ok(sender.rpc('send_chat_message', { p_channel_id: id, p_body: 'one' }))) as { created_at: string }
    const second = (await ok(sender.rpc('send_chat_message', { p_channel_id: id, p_body: 'two' }))) as { id: number }
    await markRead(id, first.created_at)
    const [row] = await chatOverview(gameId, [id])
    expect(row.last_read_at).toBe(first.created_at)
    expect(row.unread.map((r) => r.id)).toEqual([second.id])
    expect(row.latest?.id).toBe(second.id)
  })

  it('chat_overview shows nobody a conversation they are not in', async () => {
    const c = await ok(sender.rpc('create_named_channel', { p_game_id: gameId, p_members: [me.nation], p_name: 'secret' }))
    const id = (c as { id: number }).id
    await ok(sender.rpc('send_chat_message', { p_channel_id: id, p_body: 'for austria only' }))

    // A player in the same game, asking for that channel by id and for the whole game.
    const asked = await ok(bystander.rpc('chat_overview', { p_game_id: gameId, p_channel_ids: [id] }))
    expect(asked).toEqual([])
    const all = (await ok(bystander.rpc('chat_overview', { p_game_id: gameId }))) as { channel: { id: number; members: string[] } }[]
    expect(all.length).toBeGreaterThan(0) // the public channel
    expect(all.every((r) => r.channel.members.includes('germany'))).toBe(true)
    expect(all.some((r) => r.channel.id === id)).toBe(false)

    // Someone not in the game at all.
    const outsider = fresh()
    await ok(outsider.auth.signInAnonymously())
    expect(await ok(outsider.rpc('chat_overview', { p_game_id: gameId }))).toEqual([])
  })
})
