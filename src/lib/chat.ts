import { supabase } from './supabase'
import { rpc } from './rpc'
import { keepJoined, type LiveTopic } from './liveTopic'

export type { LiveTopic }

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

/** Most unread messages fetched per channel (badges show this as the ceiling); mirrors
 *  the limit in chat_overview(). */
export const UNREAD_CAP = 100

/** One channel's summary from `chat_overview`. Unread is the others' messages after the
 *  caller's cursor (id + time only, newest first, capped) — tracked by id so a message
 *  counted here and also delivered live counts once. */
export interface ChannelOverview {
  channel: ChatChannel
  last_read_at: string | null
  latest: ChatMessage | null
  unread: { id: number; created_at: string }[]
}

/** The caller's channels in a game (or just `channelIds`), each with its read cursor,
 *  newest message and unread ids — one request instead of several per channel. Runs
 *  under the caller's RLS and only covers channels their nation belongs to. */
export async function chatOverview(gameId: string, channelIds?: number[]): Promise<ChannelOverview[]> {
  if (channelIds && channelIds.length === 0) return []
  return (await rpc<ChannelOverview[] | null>('chat_overview', { p_game_id: gameId, p_channel_ids: channelIds ?? null })) ?? []
}


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

/** Live messages for a channel over its PRIVATE Broadcast topic (full payload, no
 *  follow-up fetch). Online-only: `onJoined` is where the caller fetches what the
 *  topic missed (see keepJoined). */
export function subscribeToChannel(
  channelId: number,
  onMessage: (m: ChatMessage) => void,
  onJoined: (first: boolean) => void,
): LiveTopic {
  return keepJoined(`chat:${channelId}`, { msg: (p) => onMessage(p as ChatMessage) }, onJoined)
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
  return keepJoined(`chat-inbox:${gameId}:${nation}`, { channel: (p) => onChannel(p as ChatChannel) }, onJoined)
}
