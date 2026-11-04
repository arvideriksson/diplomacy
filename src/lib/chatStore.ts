// Client state behind the in-game press panel: the viewer's conversations (channels and
// unsent drafts), which one is open, its messages, unread counts, the compose box and
// the new-conversation / rename forms — plus loading, live delivery and the draft/send
// paths. One store per mounted panel (see ChatPanel); its components only render it.
import { derived, get, writable } from 'svelte/store'
import { errorMessage } from './errors'
import { createDebouncer } from './debounce'
import { flagUrl } from './flags'
import { findPower, powerName, powerColor } from './powers'
import type { PowerDefinition } from './mapDefinition'
import type { PlayerInfo } from './game'
import {
  listChannels,
  chatOverview,
  getOrCreateChannel,
  createNamedChannel,
  renameChannel,
  fetchMessages,
  fetchOlder,
  searchMessages,
  sendMessage,
  markRead,
  subscribeToChannel,
  subscribeToInbox,
  listDrafts,
  upsertDraft,
  renameDraft,
  deleteDraft,
  type ChatChannel,
  type ChatMessage,
  type ChatDraft,
  type ChannelOverview,
  type LiveTopic,
} from './chat'

// Max conversation-name length. Mirrors the cap enforced in the create/rename RPCs
// (supabase/014_chat.sql) — keep the two in sync.
export const NAME_MAX = 60
// Max message length. Mirrors send_chat_message / upsert_chat_draft
// (supabase/migrations/20250101000145_chat_body_max.sql) — keep the two in sync.
export const BODY_MAX = 5000

/** Fields the label helpers read — satisfied by both a channel and a draft. */
export type Labelled = { members: string[]; name: string | null; is_public?: boolean }

/** A conversation row in the list: a real channel or an unsent draft, with its newest
 *  message (if any) and the time it was last active (for ordering). */
export type Conversation =
  | { kind: 'channel'; id: number; conv: ChatChannel; last: ChatMessage | null; at: string }
  | { kind: 'draft'; id: number; conv: ChatDraft; last: null; at: string }

/** Display helpers for one viewer (`nation`) on a map's powers and the game's roster. */
export function chatLabels(powers: PowerDefinition[], nation: string, players: Record<string, PlayerInfo> = {}) {
  // nation → display name + color (matched by id or name, case-insensitive).
  const display = (n: string) => powerName(powers, n)
  const colorOf = (n: string) => powerColor(powers, n, 'var(--text-secondary, #888)')
  // Flag roundel for a nation (keyed by power id); undefined if the map has no asset.
  const flagOf = (n: string): string | undefined => {
    const id = findPower(powers, n)?.id
    return id ? flagUrl[id] : undefined
  }
  // nation → the player's username (null when the seat has no named player).
  const users = new Map<string, string>()
  for (const p of Object.values(players)) if (p?.nation && p.display_name) users.set(p.nation.toLowerCase(), p.display_name)
  const userOf = (n: string): string | null => users.get(n.toLowerCase()) ?? null
  /** The player's username, falling back to the nation when there is none. */
  const who = (n: string): string => userOf(n) ?? display(n)
  const others = (c: Labelled) => c.members.filter((n) => n !== nation)
  /** A one-to-one conversation (titled by the other player rather than a nation list). */
  const isDirect = (c: Labelled) => !c.is_public && others(c).length === 1
  const channelLabel = (c: Labelled): string => {
    if (c.name) return c.name
    if (c.is_public) return 'Public press'
    if (isDirect(c)) return who(others(c)[0])
    return others(c).map(display).join(', ') || 'Notes to self'
  }
  // For a named channel, show the member list as a subtitle so you know who's in it.
  const memberList = (c: Labelled): string =>
    c.members.filter((n) => n !== nation).map(display).join(', ')
  return { display, colorOf, flagOf, userOf, who, others, isDirect, channelLabel, memberList }
}

/** A message on its way to the server (or one that failed and can be retried). */
export type Pending = { key: number; body: string; failed: boolean }

/** Per-viewer convenience state in localStorage (unsent text, pins); never required. */
function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode / storage full: the state just doesn't survive a reload */
  }
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')

const byTime = (a: ChatMessage, b: ChatMessage) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id

/** Two message lists as one, deduped by id, oldest first. */
function mergeMsgs(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const all = new Map<number, ChatMessage>()
  for (const m of a) all.set(m.id, m)
  for (const m of b) all.set(m.id, m)
  return [...all.values()].sort(byTime)
}

// created_at is the sending transaction's start time, and transactions commit in any
// order: a message can become visible after a newer one was already fetched. Delta
// fetches therefore reach back this far before the newest message held (ids dedupe).
const DELTA_OVERLAP_MS = 30_000

// How long the first load waits for its Realtime joins before reading anyway.
const JOIN_WAIT_MS = 3000
const withTimeout = (p: Promise<unknown>, ms: number) =>
  Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))])
function deltaCursor(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  return Number.isNaN(t) ? iso : new Date(t - DELTA_OVERLAP_MS).toISOString()
}

function insertMsg(arr: ChatMessage[], m: ChatMessage): ChatMessage[] {
  if (arr.some((x) => x.id === m.id)) return arr // dedupe (optimistic vs broadcast echo)
  return [...arr, m].sort(byTime)
}

/**
 * The press state for `nation` in `gameId`. `scrollToBottom` is called whenever the
 * open thread should show its newest message; `isWatching` says whether the reader can
 * see it arrive (tab visible, thread scrolled to the bottom) — only then is a message
 * in the open thread marked read.
 */
export function createChatStore(
  gameId: string,
  nation: string,
  scrollToBottom: (to?: 'unread' | 'focus') => Promise<void>,
  isWatching: () => boolean = () => true,
) {
  const channels = writable<ChatChannel[]>([])
  const activeId = writable<number | null>(null)
  const messagesByCh = writable<Record<number, ChatMessage[]>>({})
  const loaded = new Set<number>()
  const unread = writable<Record<number, number>>({})
  // What `unread` counts: per channel, the others' messages not yet seen (id → time).
  // By id, so a message both fetched and delivered live counts once.
  const unseen = new Map<number, Map<number, string>>()
  // Newest message per channel, for the list's previews and ordering.
  const latest = writable<Record<number, ChatMessage>>({})
  let myReads: Record<number, string> = {}
  // The open thread's first unread message when it was opened (the "new messages" divider).
  const unreadFrom = writable<number | null>(null)
  // Unsent text typed into a real channel, kept per channel while switching around and
  // across reloads (a draft conversation persists its body server-side instead; see
  // saveActiveDraft).
  const localKey = (what: string) => `press:${what}:${gameId}:${nation}`
  const unsent = writable<Record<number, string>>(readLocal(localKey('unsent'), {}))
  unsent.subscribe((u) => writeLocal(localKey('unsent'), u))
  // Conversations pinned to the top of the list (channel ids).
  const pinned = writable<number[]>(readLocal(localKey('pinned'), []))
  pinned.subscribe((p) => writeLocal(localKey('pinned'), p))
  // Messages being sent, per channel; a failed one stays (with a retry) in its thread,
  // across reloads too.
  const failedSaved = readLocal<Record<number, Pending[]>>(localKey('failed'), {})
  let pendingSeq = Math.max(0, ...Object.values(failedSaved).flat().map((p) => p.key))
  const pending = writable<Record<number, Pending[]>>(failedSaved)
  pending.subscribe((all) => {
    const failed = Object.fromEntries(
      Object.entries(all)
        .map(([id, list]) => [id, list.filter((p) => p.failed)] as const)
        .filter(([, list]) => list.length),
    )
    writeLocal(localKey('failed'), failed)
  })
  // Loading the conversation list: until the first load settles, and whether it failed.
  const status = writable<'loading' | 'ready' | 'error'>('loading')
  // Channels with history older than what's loaded (the first fetch is the newest 500).
  const hasOlder = writable<Record<number, boolean>>({})
  // Drafts whose latest body failed to save (retried on the next flush).
  const dirtyDrafts = new Set<number>()
  // A message to bring into view when its thread opens (from message search).
  const focusMsg = writable<number | null>(null)

  // Drafts: conversations started but not yet sent into. They persist server-side (see
  // listDrafts/upsertDraft), but the shared channel + its Realtime topic are created
  // lazily on the first send, so empty channels never hit the database. Each draft keeps
  // its own unsent body; switching away flushes it.
  const drafts = writable<ChatDraft[]>([])
  const activeDraftId = writable<number | null>(null)
  /** The compose box (an open draft restores its unsent body here). */
  const input = writable('')
  const error = writable('')
  // New-conversation picker: open, the chosen recipients and the optional group name.
  const picking = writable(false)
  const pickerSel = writable<string[]>([])
  const pickerName = writable('')
  // Inline rename of the open conversation's title.
  const renaming = writable(false)
  const renameInput = writable('')

  const active = derived([channels, activeId], ([$channels, $activeId]) => $channels.find((c) => c.id === $activeId) ?? null)
  const activeMessages = derived([messagesByCh, activeId], ([$messagesByCh, $activeId]) =>
    $activeId != null ? $messagesByCh[$activeId] ?? [] : [],
  )
  const activeDraft = derived([drafts, activeDraftId], ([$drafts, $activeDraftId]) =>
    $activeDraftId != null ? $drafts.find((d) => d.id === $activeDraftId) ?? null : null,
  )
  // The conversation shown in the thread pane: a real channel, or the open draft.
  const openChan = derived([active, activeDraft], ([$active, $activeDraft]): Labelled | null => $active ?? $activeDraft)
  // Renamable: any non-public real channel, or the open draft. (Public press keeps its
  // derived label.) Drives the double-click affordance on the title.
  const renamable = derived([active, activeDraft], ([$active, $activeDraft]) => (!!$active && !$active.is_public) || !!$activeDraft)
  // Every conversation, most recently active first (a draft counts from its last edit).
  const conversations = derived([channels, drafts, latest], ([$channels, $drafts, $latest]) => {
    const rows: Conversation[] = [
      ...$channels.map((c): Conversation => {
        const last = $latest[c.id] ?? null
        return { kind: 'channel', id: c.id, conv: c, last, at: last?.created_at ?? c.created_at }
      }),
      ...$drafts.map((d): Conversation => ({ kind: 'draft', id: d.id, conv: d, last: null, at: d.updated_at })),
    ]
    return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  })
  // Pinned conversations first (in pin order), then the rest by recency.
  const sortedConversations = derived([conversations, pinned], ([$conversations, $pinned]) => {
    const rank = (c: Conversation) => (c.kind === 'channel' && $pinned.includes(c.id) ? $pinned.indexOf(c.id) : Infinity)
    return [...$conversations].sort((a, b) => rank(a) - rank(b))
  })
  // Debounced save of the open draft's body while typing (see saveActiveDraft).
  const draftSave = createDebouncer(() => saveActiveDraft(), 1000)

  const subs = new Map<number, LiveTopic>()
  let inbox: LiveTopic | null = null
  // Topics whose first join landed after the load had already read them (it waits a
  // few seconds for joins, not forever): synced once the load is done.
  let readsStarted = false
  const lateJoins = new Set<number | 'inbox'>()

  function publishUnread(id: number) {
    const n = unseen.get(id)?.size ?? 0
    unread.update((u) => (u[id] === n ? u : { ...u, [id]: n }))
  }

  /** Take the server's view of a channel's unread messages (fetched after `cursor`),
   *  keeping live ones it couldn't have included: newer than anything it returned and
   *  than the cursor. Anything older it left out was read (maybe on another device). */
  function applyUnread(id: number, rows: { id: number; created_at: string }[], cursor: string | undefined) {
    const floor = [cursor ?? '', ...rows.map((r) => r.created_at)].reduce((a, b) => (b > a ? b : a), '')
    const next = new Map(rows.map((r) => [r.id, r.created_at] as const))
    for (const [mid, at] of unseen.get(id) ?? []) if (at > floor) next.set(mid, at)
    unseen.set(id, next)
    publishUnread(id)
  }

  function addUnseen(m: ChatMessage) {
    let set = unseen.get(m.channel_id)
    if (!set) unseen.set(m.channel_id, (set = new Map()))
    set.set(m.id, m.created_at)
    publishUnread(m.channel_id)
  }

  /** Take in channel summaries from chat_overview: the read cursor (only ever moved
   *  forward — a cursor this tab advanced may not have reached the server yet), the
   *  newest message, and the unread ids of channels whose thread isn't loaded (a loaded
   *  thread tracks its own as messages arrive). */
  function applyOverview(rows: ChannelOverview[]) {
    for (const r of rows) {
      const id = r.channel.id
      const server = r.last_read_at ?? undefined
      const cursor = server && (!myReads[id] || server > myReads[id]) ? server : myReads[id]
      if (cursor) myReads[id] = cursor
      if (!loaded.has(id)) applyUnread(id, r.unread.filter((u) => !cursor || u.created_at > cursor), cursor)
    }
    latest.update((l) => {
      const next = { ...l }
      for (const { latest: m } of rows) if (m && (!next[m.channel_id] || next[m.channel_id].created_at < m.created_at)) next[m.channel_id] = m
      return next
    })
  }

  /** Unread ids and the newest message for channels whose thread isn't loaded. */
  async function syncSummaries(ids: number[]) {
    if (!ids.length) return
    applyOverview(await chatOverview(gameId, ids))
  }

  /** Fetch what one channel's topic may have missed: a loaded thread's delta, else its
   *  unread ids and preview. */
  async function syncChannel(id: number) {
    if (loaded.has(id)) {
      const missed = await fetchMessages(id, deltaCursor(get(messagesByCh)[id]?.at(-1)?.created_at))
      for (const m of missed) await onIncoming(m)
    } else {
      await syncSummaries([id])
    }
  }

  // A channel topic joined. The first join fetches what was sent before it went live
  // (e.g. the first message of a conversation that was announced a moment ago); a
  // later one is a reconnect, which every topic does at once: one catch-up for the lot.
  function onChannelJoined(id: number, first: boolean) {
    if (get(status) !== 'ready') {
      if (readsStarted) lateJoins.add(id) // else the load's reads come after this join
      return
    }
    if (first) syncChannel(id).catch(() => {})
    else onRejoin()
  }

  function onInboxJoined(first: boolean) {
    if (get(status) !== 'ready') {
      if (readsStarted) lateJoins.add('inbox')
      return
    }
    if (first) refresh().catch(() => {})
    else onRejoin()
  }

  function store(m: ChatMessage) {
    messagesByCh.update((all) => ({ ...all, [m.channel_id]: insertMsg(all[m.channel_id] ?? [], m) }))
    latest.update((l) => (l[m.channel_id] && l[m.channel_id].created_at > m.created_at ? l : { ...l, [m.channel_id]: m }))
  }

  /** The open channel's messages are all on screen: clear its unread count and move
   *  the cursor to the newest one shown. */
  async function markSeen() {
    const id = get(activeId)
    if (id == null) return
    const last = get(messagesByCh)[id]?.at(-1)
    unseen.delete(id)
    publishUnread(id)
    if (!last) return
    myReads[id] = last.created_at
    await markRead(id, last.created_at).catch(() => {})
  }

  async function onIncoming(m: ChatMessage) {
    // Already have it (a broadcast racing a catch-up fetch, or my own send's echo).
    if (get(messagesByCh)[m.channel_id]?.some((x) => x.id === m.id)) return
    const isActive = m.channel_id === get(activeId)
    // Always store: a live message belongs in the thread even if it isn't open yet.
    // openChannel still does the full history fetch on first open and dedupes by id.
    store(m)
    if (isActive && (m.sender === nation || isWatching())) {
      await scrollToBottom()
      await markSeen()
    } else if (m.sender !== nation) {
      const cursor = myReads[m.channel_id]
      if (!cursor || m.created_at > cursor) addUnseen(m)
      if (isActive && get(unreadFrom) == null) unreadFrom.set(m.id)
    }
  }

  function subscribeAll() {
    for (const c of get(channels)) {
      if (subs.has(c.id)) continue
      subs.set(c.id, subscribeToChannel(c.id, onIncoming, (first) => onChannelJoined(c.id, first)))
    }
  }

  async function load() {
    if (!nation) return
    status.set('loading')
    try {
      await loadAll()
      status.set('ready')
      const late = [...lateJoins]
      lateJoins.clear()
      if (late.includes('inbox')) refresh().catch(() => {})
      for (const id of late) if (id !== 'inbox') syncChannel(id).catch(() => {})
    } catch (e) {
      status.set('error')
      throw e
    }
  }

  async function loadAll() {
    // Go live first and read after, so nothing sent in between is missed: join every
    // topic, wait (briefly) for the joins, then read. A join slower than the wait is
    // synced on its own once the load is done (lateJoins).
    readsStarted = false
    inbox ??= subscribeToInbox(gameId, nation, onChannel, onInboxJoined)
    await withTimeout(inbox.joined, JOIN_WAIT_MS)
    const list = await listChannels(gameId)
    channels.set(list)
    subscribeAll()
    drafts.set(await listDrafts(gameId).catch(() => []))
    await withTimeout(Promise.all(list.map((c) => subs.get(c.id)?.joined)), JOIN_WAIT_MS)
    readsStarted = true
    // Read once the topics are live, so nothing sent in between is missed.
    myReads = {}
    applyOverview(await chatOverview(gameId))
  }

  // Channels just discovered: go live first, then read their cursors, unread ids and
  // previews. A message sent before the topic joins is fetched again on its first join
  // (onChannelJoined), so the first message of a new conversation can't fall between.
  async function addChannels(added: ChatChannel[]) {
    subscribeAll()
    await syncSummaries(added.map((c) => c.id))
  }

  // A channel I belong to was created or renamed (announced on my inbox topic).
  async function onChannel(c: ChatChannel) {
    const isNew = !get(channels).some((x) => x.id === c.id)
    channels.update((list) => (isNew ? [...list, c] : list.map((x) => (x.id === c.id ? c : x))))
    if (isNew) await addChannels([c])
  }

  // New and renamed channels arrive on the inbox topic while online. Broadcast misses
  // whatever happened while hidden or offline, so catchUp re-reads on return: the
  // channel list together with every channel's cursor, preview and unread ids, in one
  // request.
  async function refresh() {
    if (!nation) return
    const rows = await chatOverview(gameId)
    channels.set(rows.map((r) => r.channel)) // also picks up renames
    subscribeAll() // channels new to this tab: their first join syncs them again
    applyOverview(rows)
  }

  // Back from a hidden tab or a dropped connection: Broadcast only reaches online
  // clients, so fetch what was missed — deltas for the threads already loaded, fresh
  // unread counts and previews for the rest. One at a time: a call while one runs shares
  // it, unless `rerun` (a rejoin, which may postdate its fetches) asks for one more pass.
  let catching: Promise<void> | null = null
  let catchAgain = false
  function catchUp(rerun = false): Promise<void> {
    if (catching) {
      if (rerun) catchAgain = true
      return catching
    }
    catching = (async () => {
      try {
        do {
          catchAgain = false
          await catchUpOnce()
        } while (catchAgain)
      } finally {
        catching = null
      }
    })()
    return catching
  }

  // Every topic rejoins at once after a reconnect: one catch-up for the lot. (On iOS the
  // resume's own catch-up runs before the socket notices it died, so this is what fetches
  // what was sent in between.)
  const rejoined = createDebouncer(() => catchUp(true).catch(() => {}), 500)
  function onRejoin() {
    if (get(status) === 'ready') rejoined.schedule()
  }

  async function catchUpOnce() {
    if (!nation) return
    if (get(status) !== 'ready') return load()
    // Topics the server closed while away (an expired token) join again right now
    // rather than at their next backoff step.
    inbox?.revive()
    for (const s of subs.values()) s.revive()
    await refresh()
    // Loaded threads fetch the messages they missed (their summaries came with refresh).
    await Promise.all(
      get(channels).filter((c) => loaded.has(c.id)).map((c) => syncChannel(c.id).catch(() => {})),
    )
  }

  // Keep what was typed into the open channel's compose box when leaving it.
  function stashInput() {
    const id = get(activeId)
    if (id == null) return
    const text = get(input)
    unsent.update((u) => {
      const { [id]: _, ...rest } = u
      return text.trim() ? { ...rest, [id]: text } : rest
    })
  }

  /** Leave whatever is open (thread, draft or picker) for the bare list. */
  function closeAll() {
    stashInput()
    saveActiveDraft()
    activeId.set(null)
    activeDraftId.set(null)
    picking.set(false)
    renaming.set(false)
    input.set('')
    unreadFrom.set(null)
  }

  // Clicking the already-open conversation in the list closes it back to the empty pane.
  function toggleChannel(id: number) {
    if (id === get(activeId)) {
      closeAll()
    } else {
      openChannel(id)
    }
  }

  function toggleDraft(id: number) {
    if (id === get(activeDraftId)) {
      saveActiveDraft()
      activeDraftId.set(null)
      input.set('')
    } else {
      openDraft(id)
    }
  }

  async function openChannel(id: number, focusing = false) {
    stashInput()
    await saveActiveDraft() // flush a draft I was composing before leaving it
    error.set('')
    renaming.set(false)
    activeId.set(id)
    activeDraftId.set(null)
    picking.set(false)
    input.set(get(unsent)[id] ?? '')
    if (!loaded.has(id)) {
      try {
        const msgs = await fetchMessages(id)
        // Merge, don't replace: a message delivered live during the fetch stays.
        messagesByCh.update((all) => ({ ...all, [id]: mergeMsgs(all[id] ?? [], msgs) }))
        hasOlder.update((h) => ({ ...h, [id]: msgs.length >= 500 }))
        loaded.add(id)
      } catch (e) {
        error.set(errorMessage(e))
        return
      }
    }
    // Open at the first unread message (by my read cursor) if there is one, else at the
    // end; what's on screen then counts as read.
    const cursor = myReads[id]
    const firstNew = get(unread)[id]
      ? (get(messagesByCh)[id] ?? []).find((m) => m.sender !== nation && (!cursor || m.created_at > cursor))
      : undefined
    unreadFrom.set(firstNew?.id ?? null)
    if (focusing) return // openAt scrolls to its message; reading down marks it read
    await scrollToBottom(firstNew ? 'unread' : undefined)
    if (isWatching()) await markSeen()
  }

  async function openDraft(id: number) {
    stashInput()
    await saveActiveDraft() // flush the previously open draft first
    error.set('')
    activeId.set(null)
    activeDraftId.set(id)
    picking.set(false)
    renaming.set(false)
    input.set(get(drafts).find((d) => d.id === id)?.body ?? '')
  }

  // Persist the open draft's body. Debounced while typing and flushed on any switch/exit
  // so leaving a half-written message never loses it. No-op when nothing changed.
  async function saveActiveDraft() {
    draftSave.cancel()
    const draftId = get(activeDraftId)
    if (draftId == null) return
    const d = get(drafts).find((x) => x.id === draftId)
    const body = get(input)
    if (!d || (d.body === body && !dirtyDrafts.has(d.id))) return
    // Keep the edit locally first, so reopening the draft shows it even if the save fails.
    drafts.update((list) => list.map((x) => (x.id === d.id ? { ...x, body } : x)))
    try {
      const updated = await upsertDraft(gameId, d.members.filter((n) => n !== nation), d.name, body)
      dirtyDrafts.delete(d.id)
      drafts.update((list) => list.map((x) => (x.id === updated.id ? updated : x)))
    } catch {
      dirtyDrafts.add(d.id) // the next flush retries
    }
  }

  /** The compose box changed: keep a channel's text (so a reload can't lose it), or
   *  debounce-save an open draft's body. */
  function onCompose() {
    if (get(activeId) != null) stashInput()
    if (get(activeDraftId) == null) return
    draftSave.schedule()
  }

  /** Messages matching `query` across all of the viewer's conversations. */
  function search(query: string): Promise<ChatMessage[]> {
    return searchMessages(get(channels).map((c) => c.id), query)
  }

  /** Load the page of history before the oldest loaded message. Returns how many came. */
  async function loadOlder(channelId: number): Promise<number> {
    const first = get(messagesByCh)[channelId]?.[0]
    if (!first) return 0
    const older = await fetchOlder(channelId, first.created_at)
    messagesByCh.update((all) => ({ ...all, [channelId]: [...older, ...(all[channelId] ?? [])] }))
    hasOlder.update((h) => ({ ...h, [channelId]: older.length >= 200 }))
    return older.length
  }

  /** Open a channel scrolled to one of its messages (a search result), paging back
   *  through history if it's older than what's loaded. */
  async function openAt(channelId: number, messageId: number) {
    if (get(activeId) !== channelId) await openChannel(channelId, true)
    const has = () => get(messagesByCh)[channelId]?.some((m) => m.id === messageId)
    for (let page = 0; !has() && get(hasOlder)[channelId] && page < 20; page++) {
      if ((await loadOlder(channelId).catch(() => 0)) === 0) break
    }
    focusMsg.set(messageId)
    await scrollToBottom('focus')
  }

  async function discardDraft(id: number) {
    draftSave.cancel()
    drafts.update((list) => list.filter((x) => x.id !== id))
    if (get(activeDraftId) === id) {
      activeDraftId.set(null)
      input.set('')
    }
    await deleteDraft(id).catch(() => {})
  }

  async function send() {
    const body = get(input).trim()
    if (!body) return
    if (get(activeDraftId) == null && get(activeId) == null) return
    error.set('')
    // First message into a draft: create the real channel now, promote (the draft is
    // superseded), then send. We delete the draft once the channel exists so a failed
    // resend can't recreate a duplicate named channel — it just resends to the channel.
    const openDraftId = get(activeDraftId)
    if (openDraftId != null) {
      const d = get(drafts).find((x) => x.id === openDraftId)
      if (!d) {
        activeDraftId.set(null)
        return
      }
      draftSave.cancel()
      try {
        const others = d.members.filter((n) => n !== nation)
        const c = d.name
          ? await createNamedChannel(gameId, others, d.name)
          : await getOrCreateChannel(gameId, others)
        if (!get(channels).some((x) => x.id === c.id)) channels.update((list) => [...list, c])
        subscribeAll()
        drafts.update((list) => list.filter((x) => x.id !== d.id))
        if (get(activeDraftId) === d.id) {
          activeDraftId.set(null)
          activeId.set(c.id)
        }
        loaded.add(c.id) // freshly created — its (empty) history is already known
        await deleteDraft(d.id).catch(() => {})
        await deliver(c.id, body)
      } catch (e) {
        error.set(errorMessage(e)) // the draft (and its text) stays as it was
      }
      return
    }
    await deliver(get(activeId)!, body)
  }

  // Send `body` to `channelId`, showing it as pending until the server has it. A
  // failure leaves it in that thread (with a retry) instead of in the compose box.
  async function deliver(channelId: number, body: string, retryKey?: number) {
    const key = retryKey ?? ++pendingSeq
    const setPending = (fn: (list: Pending[]) => Pending[]) =>
      pending.update((all) => ({ ...all, [channelId]: fn(all[channelId] ?? []) }))
    if (retryKey == null) {
      if (get(activeId) === channelId) input.set('')
      unsent.update(({ [channelId]: _, ...rest }) => rest)
      setPending((list) => [...list, { key, body, failed: false }])
    } else {
      setPending((list) => list.map((p) => (p.key === key ? { ...p, failed: false } : p)))
    }
    if (get(activeId) === channelId) {
      unreadFrom.set(null)
      await scrollToBottom()
    }
    try {
      const m = await sendMessage(channelId, body)
      setPending((list) => list.filter((p) => p.key !== key))
      store(m) // broadcast echo dedupes by id
      if (get(activeId) === channelId) {
        await scrollToBottom()
        await markSeen()
      }
    } catch {
      setPending((list) => list.map((p) => (p.key === key ? { ...p, failed: true } : p)))
    }
  }

  /** Try a failed message again. */
  function retry(channelId: number, key: number) {
    const p = get(pending)[channelId]?.find((x) => x.key === key)
    if (p) deliver(channelId, p.body, key)
  }

  /** Give up on a failed message. */
  function dropPending(channelId: number, key: number) {
    pending.update((all) => ({ ...all, [channelId]: (all[channelId] ?? []).filter((p) => p.key !== key) }))
  }

  function togglePin(id: number) {
    pinned.update((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  function togglePick(n: string) {
    pickerSel.update((sel) => (sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n]))
  }

  function cancelPicking() {
    picking.set(false)
    pickerSel.set([])
    pickerName.set('')
  }

  async function startConversation() {
    const selected = get(pickerSel)
    if (selected.length === 0) return
    error.set('')
    const name = get(pickerName).trim()
    const members = [...new Set([nation, ...selected])] // server-canonical set (incl. self)

    // Unnamed sets auto-reuse: if a thread for this exact set already exists, open it
    // instead of starting a new draft. Named groups always begin a fresh draft.
    if (!name) {
      const existing = get(channels).find((c) => !c.name && !c.is_public && sameSet(c.members, members))
      if (existing) {
        pickerSel.set([])
        pickerName.set('')
        openChannel(existing.id)
        return
      }
    }

    // The shared channel is still deferred to the first send — but persist the draft now
    // (recipients + name) so it survives leaving. upsert dedupes by set+name.
    try {
      const d = await upsertDraft(gameId, selected, name || null, '')
      drafts.update((list) => [...list.filter((x) => x.id !== d.id), d])
      pickerSel.set([])
      pickerName.set('')
      await openDraft(d.id)
    } catch (e) {
      error.set(errorMessage(e))
    }
  }

  // Open the new-conversation picker (flushing any draft I'm leaving).
  async function startPicking() {
    stashInput()
    await saveActiveDraft() // before clearing the box, which holds the draft's body
    input.set('')
    picking.set(true)
    activeId.set(null)
    activeDraftId.set(null)
  }

  function startRename() {
    if (!get(renamable)) return
    renameInput.set((get(active)?.name ?? get(activeDraft)?.name) ?? '')
    renaming.set(true)
  }

  async function submitRename() {
    const name = get(renameInput).trim()
    if (!name) {
      renaming.set(false)
      return
    }
    const channel = get(active)
    const draft = get(activeDraft)
    try {
      if (channel) {
        await renameChannel(channel.id, name)
        channels.update((list) => list.map((c) => (c.id === channel.id ? { ...c, name } : c)))
      } else if (draft) {
        const updated = await renameDraft(draft.id, name)
        drafts.update((list) => list.map((x) => (x.id === updated.id ? updated : x)))
      }
      renaming.set(false)
    } catch (e) {
      error.set(errorMessage(e))
    }
  }

  /** Stop live delivery and flush the open draft (best effort). */
  function destroy() {
    saveActiveDraft() // best-effort final flush of the open draft's body (cancels the timer)
    rejoined.cancel()
    for (const s of subs.values()) s.stop()
    subs.clear()
    inbox?.stop()
    inbox = null
  }

  return {
    channels,
    activeId,
    messagesByCh,
    unread,
    latest,
    conversations,
    unreadFrom,
    unsent,
    pinned,
    pending,
    focusMsg,
    status,
    hasOlder,
    sortedConversations,
    drafts,
    activeDraftId,
    input,
    error,
    picking,
    pickerSel,
    pickerName,
    renaming,
    renameInput,
    active,
    activeMessages,
    activeDraft,
    openChan,
    renamable,
    load,
    refresh,
    catchUp,
    markSeen,
    closeAll,
    retry,
    search,
    openAt,
    loadOlder,
    dropPending,
    togglePin,
    toggleChannel,
    toggleDraft,
    openChannel,
    openDraft,
    saveActiveDraft,
    onCompose,
    discardDraft,
    send,
    togglePick,
    cancelPicking,
    startConversation,
    startPicking,
    startRename,
    submitRename,
    destroy,
  }
}

export type ChatStore = ReturnType<typeof createChatStore>
