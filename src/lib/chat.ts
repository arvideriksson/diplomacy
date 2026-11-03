import { supabase } from './supabase'
import { rpc } from './rpc'
import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js'

/**
 * Secret group chat ("press"). Mirrors the free-tier economy levers in the schema
 * (see the chat migration in supabase/migrations/): a channel IS its sorted member set, live delivery is
 * online-only full-payload Broadcast over a PRIVATE topic, and offline catch-up is a
 * delta (since-cursor) read from the table — never a full re-download.
 */

export interface ChatChannel {
  id: number
  game_id: string
  members: string[]
  is_public: boolean
  /** Null = unnamed (auto-reused by member set); set = a distinct named group. */
  name: string | null
  created_at: string
}

export interface ChatMessage {
  id: number
  channel_id: number
  sender: string // nation
  body: string
  created_at: string
}

/** A private, per-nation draft: a conversation started but not yet sent into. The real
 *  channel is created only when the draft is sent (see send path); until then it lives
 *  here so it survives reload. members includes the owner (server-canonical set). */
export interface ChatDraft {
  id: number
  game_id: string
  members: string[]
  name: string | null
  body: string
  updated_at: string
}

/** Channels the caller is a member of (RLS filters to membership). Public first. */
export async function listChannels(gameId: string): Promise<ChatChannel[]> {
  const { data, error } = await supabase
    .from('chat_channels')
    .select('*')
    .eq('game_id', gameId)
    .order('is_public', { ascending: false })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as ChatChannel[]
}

/** The caller's drafts for a game (RLS filters to own nation), oldest→newest. */
export async function listDrafts(gameId: string): Promise<ChatDraft[]> {
  const { data, error } = await supabase
    .from('chat_drafts')
    .select('*')
    .eq('game_id', gameId)
    .order('updated_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ChatDraft[]
}

/** Create or update the caller's draft for a recipient set (+ optional name). `members`
 *  is the OTHER members — the RPC adds the caller, mirroring the channel RPCs. */
export async function upsertDraft(
  gameId: string,
  members: string[],
  name: string | null,
  body: string,
): Promise<ChatDraft> {
  return rpc<ChatDraft>('upsert_chat_draft', {
    p_game_id: gameId,
    p_members: members,
    p_name: name,
    p_body: body,
  })
}

/** Rename one of the caller's drafts (by id; recipient set unchanged). */
export async function renameDraft(draftId: number, name: string): Promise<ChatDraft> {
  return rpc<ChatDraft>('rename_chat_draft', { p_draft_id: draftId, p_name: name })
}

/** Delete one of the caller's drafts (on send, or explicit discard). Idempotent. */
export async function deleteDraft(draftId: number): Promise<void> {
  await rpc('delete_chat_draft', { p_draft_id: draftId })
}

/** Open or reuse the UNNAMED channel for exactly {caller} ∪ members (the auto-reuse path). */
export async function getOrCreateChannel(gameId: string, members: string[]): Promise<ChatChannel> {
  return rpc<ChatChannel>('get_or_create_channel', {
    p_game_id: gameId,
    p_members: members,
  })
}

/** Create a NAMED group for {caller} ∪ members. Always a fresh channel (names can repeat members). */
export async function createNamedChannel(gameId: string, members: string[], name: string): Promise<ChatChannel> {
  return rpc<ChatChannel>('create_named_channel', {
    p_game_id: gameId,
    p_members: members,
    p_name: name,
  })
}

/** Rename a channel. Any member may do this; the public channel cannot be renamed. */
export async function renameChannel(channelId: number, name: string): Promise<void> {
  await rpc('rename_channel', { p_channel_id: channelId, p_name: name })
}

/** Delta history: the newest 500 messages in a channel (oldest first), optionally only
 *  those after `sinceIso`. */
export async function fetchMessages(channelId: number, sinceIso?: string): Promise<ChatMessage[]> {
  let q = supabase.from('chat_messages').select('*').eq('channel_id', channelId)
  if (sinceIso) q = q.gt('created_at', sinceIso)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
  if (error) throw error
  return ((data ?? []) as ChatMessage[]).reverse()
}

/** A page of history from before `beforeIso` (oldest first), for scrolling further back. */
export async function fetchOlder(channelId: number, beforeIso: string, limit = 200): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('channel_id', channelId)
    .lt('created_at', beforeIso)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as ChatMessage[]).reverse()
}

/** The newest message of each channel (for list previews): one single-row read per
 *  channel, so egress stays a few rows rather than whole histories. */
export async function latestMessages(channelIds: number[]): Promise<Record<number, ChatMessage>> {
  const rows = await Promise.all(
    channelIds.map(async (id) => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('channel_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as ChatMessage | null
    }),
  )
  const out: Record<number, ChatMessage> = {}
  for (const m of rows) if (m) out[m.channel_id] = m
  return out
}

/** Messages in these channels whose text contains `query` (newest first, capped) —
 *  RLS already limits the read to channels the caller belongs to. */
export async function searchMessages(channelIds: number[], query: string): Promise<ChatMessage[]> {
  if (channelIds.length === 0 || !query.trim()) return []
  const pattern = `%${query.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .in('channel_id', channelIds)
    .ilike('body', pattern)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data ?? []) as ChatMessage[]
}

/** Others' messages after a cursor (id + time only, newest first, capped) — unread
 *  is tracked by id so a message counted here and also delivered live counts once.
 *  The caller's own messages never count, whatever the cursor says. */
export async function unreadSince(
  channelId: number,
  nation: string,
  sinceIso?: string,
): Promise<{ id: number; created_at: string }[]> {
  let q = supabase
    .from('chat_messages')
    .select('id,created_at')
    .eq('channel_id', channelId)
    .neq('sender', nation)
  if (sinceIso) q = q.gt('created_at', sinceIso)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(UNREAD_CAP)
  if (error) throw error
  return (data ?? []) as { id: number; created_at: string }[]
}

/** Most unread messages fetched per channel (badges show this as the ceiling). */
export const UNREAD_CAP = 100

export async function sendMessage(channelId: number, body: string): Promise<ChatMessage> {
  return rpc<ChatMessage>('send_chat_message', {
    p_channel_id: channelId,
    p_body: body,
  })
}

/** Advance the read cursor to `upTo` — the newest message actually on screen, not the
 *  server's clock, so a message committed but not yet delivered stays unread. */
export async function markRead(channelId: number, upTo: string): Promise<void> {
  await rpc('mark_chat_read', { p_channel_id: channelId, p_up_to: upTo })
}

/** The caller's read cursor per channel, for the given channels. Scoped by channel id
 *  (not just nation) so a nation name can't bleed across games the user plays. */
export async function fetchMyReads(channelIds: number[], nation: string): Promise<Record<number, string>> {
  if (channelIds.length === 0) return {}
  const { data, error } = await supabase
    .from('chat_reads')
    .select('channel_id,last_read_at')
    .in('channel_id', channelIds)
    .eq('nation', nation)
  if (error) throw error
  const out: Record<number, string> = {}
  for (const r of data ?? []) out[(r as { channel_id: number }).channel_id] = (r as { last_read_at: string }).last_read_at
  return out
}

// Before joining a private topic, make sure Realtime holds a current access token: the
// join carries it for the Realtime Authorization (RLS) check, so a join raced against an
// unset token is refused. Pulled through supabase-js's accessToken callback rather than
// passed in — a token passed in counts as "manual" and turns off realtime-js's own
// refresh on every heartbeat, which is what keeps a long-lived join from expiring.
async function ensureRealtimeAuth(): Promise<void> {
  await supabase.realtime.setAuth()
}

/** A private Broadcast topic kept joined for as long as it's wanted. */
export interface LiveTopic {
  /** Leave the topic for good. */
  stop(): void
  /** Join again now if the server closed it (e.g. back from a suspended tab). */
  revive(): void
  /** Settles on the first successful join. */
  joined: Promise<void>
}

// Backoff between attempts to re-join a topic the server closed.
const REJOIN_MS = [1000, 2000, 5000, 10_000, 30_000]

/**
 * Join a private Broadcast topic and keep it joined. `onJoined` runs after EVERY
 * successful join — `first` on the very first — since whatever was broadcast before
 * the join (or while it was down) never arrives and has to be fetched.
 *
 * A dropped socket or a refused/timed-out join is retried by realtime-js itself, but a
 * topic the SERVER closes (it does when the access token expires, e.g. while a phone
 * kept the app suspended past the token's lifetime) is removed from the socket for good.
 * That's what made live press die silently; here a closed topic is joined afresh.
 */
function keepJoined(
  topic: string,
  event: string,
  onPayload: (payload: unknown) => void,
  onJoined: (first: boolean) => void,
): LiveTopic {
  let current: RealtimeChannel | null = null
  let stopped = false
  let joinedOnce = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let markJoined = () => {}
  const joined = new Promise<void>((resolve) => (markJoined = resolve))

  async function open() {
    timer = null
    if (stopped) return
    await ensureRealtimeAuth().catch(() => {})
    if (stopped || current) return
    const ch = supabase.channel(topic, { config: { private: true } })
    current = ch
    ch.on('broadcast', { event }, (msg) => onPayload(msg.payload)).subscribe((status) => {
      if (stopped || current !== ch) return
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        attempt = 0
        const first = !joinedOnce
        joinedOnce = true
        markJoined()
        onJoined(first)
      } else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
        current = null
        retryLater()
      }
      // CHANNEL_ERROR / TIMED_OUT: the channel stays on the socket and rejoins by itself.
    })
  }

  function retryLater() {
    if (stopped || timer) return
    timer = setTimeout(open, REJOIN_MS[Math.min(attempt++, REJOIN_MS.length - 1)])
  }

  void open()
  return {
    joined,
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      const ch = current
      current = null
      if (ch) supabase.removeChannel(ch)
    },
    revive() {
      if (stopped) return
      if (current && current.state !== 'closed') return
      if (timer) clearTimeout(timer)
      timer = null
      current = null
      void open()
    },
  }
}

/** Live messages for a channel over its PRIVATE Broadcast topic (full payload, no
 *  follow-up fetch). Online-only: `onJoined` is where the caller fetches what the
 *  topic missed (see keepJoined). */
export function subscribeToChannel(
  channelId: number,
  onMessage: (m: ChatMessage) => void,
  onJoined: (first: boolean) => void,
): LiveTopic {
  return keepJoined(`chat:${channelId}`, 'msg', (p) => onMessage(p as ChatMessage), onJoined)
}

/**
 * The caller's private inbox for a game: every channel they belong to is broadcast here
 * when it's created or renamed (supabase/migrations/…_chat_channel_announce.sql).
 */
export function subscribeToInbox(
  gameId: string,
  nation: string,
  onChannel: (c: ChatChannel) => void,
  onJoined: (first: boolean) => void,
): LiveTopic {
  return keepJoined(`chat-inbox:${gameId}:${nation}`, 'channel', (p) => onChannel(p as ChatChannel), onJoined)
}
