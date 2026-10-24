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
import {
  listChannels,
  getOrCreateChannel,
  createNamedChannel,
  renameChannel,
  fetchMessages,
  unreadCount,
  sendMessage,
  markRead,
  fetchMyReads,
  subscribeToChannel,
  listDrafts,
  upsertDraft,
  renameDraft,
  deleteDraft,
  type ChatChannel,
  type ChatMessage,
  type ChatDraft,
} from './chat'

// Max conversation-name length. Mirrors the cap enforced in the create/rename RPCs
// (supabase/014_chat.sql) — keep the two in sync.
export const NAME_MAX = 60

/** Fields the label helpers read — satisfied by both a channel and a draft. */
export type Labelled = { members: string[]; name: string | null; is_public?: boolean }

/** Display helpers for one viewer (`nation`) on a map's powers. */
export function chatLabels(powers: PowerDefinition[], nation: string) {
  // nation → display name + color (matched by id or name, case-insensitive).
  const display = (n: string) => powerName(powers, n)
  const colorOf = (n: string) => powerColor(powers, n, 'var(--text-secondary, #888)')
  // Flag roundel for a nation (keyed by power id); undefined if the map has no asset.
  const flagOf = (n: string): string | undefined => {
    const id = findPower(powers, n)?.id
    return id ? flagUrl[id] : undefined
  }
  const channelLabel = (c: Labelled): string => {
    if (c.name) return c.name
    if (c.is_public) return 'Public press'
    const others = c.members.filter((n) => n !== nation)
    return others.map(display).join(', ') || 'Notes to self'
  }
  // For a named channel, show the member list as a subtitle so you know who's in it.
  const memberList = (c: Labelled): string =>
    c.members.filter((n) => n !== nation).map(display).join(', ')
  return { display, colorOf, flagOf, channelLabel, memberList }
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')

function insertMsg(arr: ChatMessage[], m: ChatMessage): ChatMessage[] {
  if (arr.some((x) => x.id === m.id)) return arr // dedupe (optimistic vs broadcast echo)
  const next = [...arr, m]
  next.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id))
  return next
}

/**
 * The press state for `nation` in `gameId`. `scrollToBottom` is called whenever the
 * open thread should show its newest message.
 */
export function createChatStore(gameId: string, nation: string, scrollToBottom: () => Promise<void>) {
  const channels = writable<ChatChannel[]>([])
  const activeId = writable<number | null>(null)
  const messagesByCh = writable<Record<number, ChatMessage[]>>({})
  const loaded = new Set<number>()
  const unread = writable<Record<number, number>>({})
  let myReads: Record<number, string> = {}

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
  // Debounced save of the open draft's body while typing (see saveActiveDraft).
  const draftSave = createDebouncer(() => saveActiveDraft(), 1000)

  const unsubs = new Map<number, () => void>()

  function store(m: ChatMessage) {
    messagesByCh.update((all) => ({ ...all, [m.channel_id]: insertMsg(all[m.channel_id] ?? [], m) }))
  }

  async function onIncoming(m: ChatMessage) {
    const isActive = m.channel_id === get(activeId)
    // Always store: a live message belongs in the thread even if it isn't open yet.
    // openChannel still does the full history fetch on first open and dedupes by id.
    store(m)
    if (isActive) {
      unread.update((u) => ({ ...u, [m.channel_id]: 0 }))
      await markRead(m.channel_id).catch(() => {})
      await scrollToBottom()
    } else if (m.sender !== nation) {
      unread.update((u) => ({ ...u, [m.channel_id]: (u[m.channel_id] ?? 0) + 1 }))
    }
  }

  async function subscribeAll() {
    for (const c of get(channels)) {
      if (unsubs.has(c.id)) continue
      unsubs.set(c.id, await subscribeToChannel(c.id, onIncoming))
    }
  }

  async function load() {
    if (!nation) return
    const list = await listChannels(gameId)
    channels.set(list)
    drafts.set(await listDrafts(gameId).catch(() => []))
    myReads = await fetchMyReads(list.map((c) => c.id), nation)
    const counts = await Promise.all(list.map((c) => unreadCount(c.id, myReads[c.id]).catch(() => 0)))
    unread.set(Object.fromEntries(list.map((c, i) => [c.id, counts[i]])))
    await subscribeAll()
  }

  // Channels are delivered over Broadcast, not postgres_changes, so a conversation a
  // teammate opens mid-game won't appear on its own. Re-list periodically (and on tab
  // focus) and subscribe to anything new — once subscribed, delivery is instant.
  async function refresh() {
    if (!nation) return
    const list = await listChannels(gameId)
    const known = new Set(get(channels).map((c) => c.id))
    const added = list.filter((c) => !known.has(c.id))
    channels.set(list) // also picks up renames
    if (added.length) {
      const reads = await fetchMyReads(added.map((c) => c.id), nation)
      const counts = await Promise.all(added.map((c) => unreadCount(c.id, reads[c.id]).catch(() => 0)))
      unread.update((u) => ({ ...u, ...Object.fromEntries(added.map((c, i) => [c.id, counts[i]])) }))
    }
    await subscribeAll()
  }

  // Clicking the already-open conversation in the list closes it back to the empty pane.
  function toggleChannel(id: number) {
    if (id === get(activeId)) {
      activeId.set(null)
      renaming.set(false)
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

  async function openChannel(id: number) {
    await saveActiveDraft() // flush a draft I was composing before leaving it
    error.set('')
    activeId.set(id)
    activeDraftId.set(null)
    picking.set(false)
    input.set('') // real channels don't restore unsent text — only drafts do
    if (!loaded.has(id)) {
      try {
        const msgs = await fetchMessages(id)
        messagesByCh.update((all) => ({ ...all, [id]: msgs }))
        loaded.add(id)
      } catch (e) {
        error.set(errorMessage(e))
        return
      }
    }
    unread.update((u) => ({ ...u, [id]: 0 }))
    await markRead(id).catch(() => {})
    await scrollToBottom()
  }

  async function openDraft(id: number) {
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
    if (!d || d.body === body) return
    try {
      const updated = await upsertDraft(gameId, d.members.filter((n) => n !== nation), d.name, body)
      drafts.update((list) => list.map((x) => (x.id === updated.id ? updated : x)))
    } catch {
      /* keep the local edit; the next flush retries */
    }
  }

  /** The compose box changed: debounce-save it when a draft is open. */
  function onCompose() {
    if (get(activeDraftId) == null) return
    draftSave.schedule()
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
    input.set('')
    error.set('')
    try {
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
        const others = d.members.filter((n) => n !== nation)
        const c = d.name
          ? await createNamedChannel(gameId, others, d.name)
          : await getOrCreateChannel(gameId, others)
        if (!get(channels).some((x) => x.id === c.id)) channels.update((list) => [...list, c])
        await subscribeAll()
        const draftId = d.id
        drafts.update((list) => list.filter((x) => x.id !== draftId))
        activeDraftId.set(null)
        activeId.set(c.id)
        loaded.add(c.id) // freshly created — its (empty) history is already known
        await deleteDraft(draftId).catch(() => {})
      }
      const channelId = get(activeId)!
      store(await sendMessage(channelId, body)) // optimistic; broadcast echo dedupes by id
      await markRead(channelId).catch(() => {})
      await scrollToBottom()
    } catch (e) {
      error.set(errorMessage(e))
      input.set(body) // restore so the user doesn't lose the text
    }
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
    await saveActiveDraft()
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
    for (const u of unsubs.values()) u()
    unsubs.clear()
  }

  return {
    channels,
    activeId,
    messagesByCh,
    unread,
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
