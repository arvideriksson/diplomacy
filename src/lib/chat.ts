import { supabase } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

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
  const { data, error } = await supabase.rpc('upsert_chat_draft', {
    p_game_id: gameId,
    p_members: members,
    p_name: name,
    p_body: body,
  })
  if (error) throw error
  return data as ChatDraft
}

/** Rename one of the caller's drafts (by id; recipient set unchanged). */
export async function renameDraft(draftId: number, name: string): Promise<ChatDraft> {
  const { data, error } = await supabase.rpc('rename_chat_draft', { p_draft_id: draftId, p_name: name })
  if (error) throw error
  return data as ChatDraft
}

/** Delete one of the caller's drafts (on send, or explicit discard). Idempotent. */
export async function deleteDraft(draftId: number): Promise<void> {
  const { error } = await supabase.rpc('delete_chat_draft', { p_draft_id: draftId })
  if (error) throw error
}

/** Open or reuse the UNNAMED channel for exactly {caller} ∪ members (the auto-reuse path). */
export async function getOrCreateChannel(gameId: string, members: string[]): Promise<ChatChannel> {
  const { data, error } = await supabase.rpc('get_or_create_channel', {
    p_game_id: gameId,
    p_members: members,
  })
  if (error) throw error
  return data as ChatChannel
}

/** Create a NAMED group for {caller} ∪ members. Always a fresh channel (names can repeat members). */
export async function createNamedChannel(gameId: string, members: string[], name: string): Promise<ChatChannel> {
  const { data, error } = await supabase.rpc('create_named_channel', {
    p_game_id: gameId,
    p_members: members,
    p_name: name,
  })
  if (error) throw error
  return data as ChatChannel
}

/** Rename a channel. Any member may do this; the public channel cannot be renamed. */
export async function renameChannel(channelId: number, name: string): Promise<void> {
  const { error } = await supabase.rpc('rename_channel', { p_channel_id: channelId, p_name: name })
  if (error) throw error
}

/** Delta history: messages in a channel, optionally only those after `sinceIso`. */
export async function fetchMessages(channelId: number, sinceIso?: string): Promise<ChatMessage[]> {
  let q = supabase.from('chat_messages').select('*').eq('channel_id', channelId)
  if (sinceIso) q = q.gt('created_at', sinceIso)
  const { data, error } = await q.order('created_at', { ascending: true }).limit(500)
  if (error) throw error
  return (data ?? []) as ChatMessage[]
}

/** Count of messages after a cursor — head:true returns the count with no row egress. */
export async function unreadCount(channelId: number, sinceIso?: string): Promise<number> {
  let q = supabase.from('chat_messages').select('*', { count: 'exact', head: true }).eq('channel_id', channelId)
  if (sinceIso) q = q.gt('created_at', sinceIso)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

export async function sendMessage(channelId: number, body: string): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('send_chat_message', {
    p_channel_id: channelId,
    p_body: body,
  })
  if (error) throw error
  return data as ChatMessage
}

export async function markRead(channelId: number): Promise<void> {
  const { error } = await supabase.rpc('mark_chat_read', { p_channel_id: channelId })
  if (error) throw error
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

// Realtime needs the user's JWT to authorize private-channel subscriptions. Set it
// once; the access token is stable for the session and refreshes are picked up here.
let authedToken: string | null = null
async function ensureRealtimeAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? null
  if (token && token !== authedToken) {
    // Must complete before we subscribe to a private topic — the join carries this
    // token for the Realtime Authorization (RLS) check. Firing it un-awaited races
    // the subscribe and can join a private channel with no/stale auth.
    await supabase.realtime.setAuth(token)
    authedToken = token
  }
}

/**
 * Subscribe to live messages for a channel over its PRIVATE Broadcast topic. Delivery
 * is online-only and carries the full message payload, so the handler receives the
 * complete row with no follow-up fetch. Returns an unsubscribe function.
 */
export async function subscribeToChannel(
  channelId: number,
  onMessage: (m: ChatMessage) => void,
): Promise<() => void> {
  await ensureRealtimeAuth()
  const channel: RealtimeChannel = supabase
    .channel(`chat:${channelId}`, { config: { private: true } })
    .on('broadcast', { event: 'msg' }, (payload) => {
      onMessage(payload.payload as ChatMessage)
    })
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
