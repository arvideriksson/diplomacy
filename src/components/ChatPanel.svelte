<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import type { PlayerInfo } from '../lib/game'
  import {
    listChannels,
    getOrCreateChannel,
    fetchMessages,
    unreadCount,
    sendMessage,
    markRead,
    fetchMyReads,
    subscribeToChannel,
    type ChatChannel,
    type ChatMessage,
  } from '../lib/chat'

  export let gameId: string
  /** The viewer's nation. Chat is unavailable without one (spectators get no press). */
  export let nation: string
  /** game.players — used to map nation → display name and to list possible recipients. */
  export let players: Record<string, PlayerInfo> = {}

  let channels: ChatChannel[] = []
  let activeId: number | null = null
  let messagesByCh: Record<number, ChatMessage[]> = {}
  const loaded = new Set<number>()
  let unread: Record<number, number> = {}
  let myReads: Record<number, string> = {}

  let open = false
  let input = ''
  let error = ''
  let picking = false
  let pickerSel: string[] = []

  const unsubs = new Map<number, () => void>()
  let scroller: HTMLDivElement | null = null

  // nation → display name (falls back to the nation itself).
  $: nameByNation = (() => {
    const m: Record<string, string> = {}
    for (const p of Object.values(players)) if (p.nation) m[p.nation] = p.display_name ?? p.nation
    return m
  })()
  const display = (n: string) => nameByNation[n] ?? n

  $: otherNations = Object.values(players)
    .map((p) => p.nation)
    .filter((n): n is string => !!n && n !== nation)
    .sort()

  $: totalUnread = Object.values(unread).reduce((a, b) => a + b, 0)
  $: activeMessages = activeId != null ? messagesByCh[activeId] ?? [] : []

  const channelLabel = (c: ChatChannel): string => {
    if (c.is_public) return 'All players'
    const others = c.members.filter((n) => n !== nation)
    return others.map(display).join(', ') || 'Notes to self'
  }

  function insertMsg(arr: ChatMessage[], m: ChatMessage): ChatMessage[] {
    if (arr.some((x) => x.id === m.id)) return arr // dedupe (optimistic vs broadcast echo)
    const next = [...arr, m]
    next.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id))
    return next
  }

  function store(m: ChatMessage) {
    messagesByCh = { ...messagesByCh, [m.channel_id]: insertMsg(messagesByCh[m.channel_id] ?? [], m) }
  }

  async function onIncoming(m: ChatMessage) {
    const isActive = open && m.channel_id === activeId
    if (isActive || loaded.has(m.channel_id)) store(m)
    if (isActive) {
      unread = { ...unread, [m.channel_id]: 0 }
      await markRead(m.channel_id).catch(() => {})
      await scrollToBottom()
    } else if (m.sender !== nation) {
      unread = { ...unread, [m.channel_id]: (unread[m.channel_id] ?? 0) + 1 }
    }
  }

  async function subscribeAll() {
    for (const c of channels) {
      if (unsubs.has(c.id)) continue
      unsubs.set(c.id, await subscribeToChannel(c.id, onIncoming))
    }
  }

  async function load() {
    if (!nation) return
    channels = await listChannels(gameId)
    myReads = await fetchMyReads(channels.map((c) => c.id), nation)
    const counts = await Promise.all(channels.map((c) => unreadCount(c.id, myReads[c.id]).catch(() => 0)))
    unread = Object.fromEntries(channels.map((c, i) => [c.id, counts[i]]))
    await subscribeAll()
  }

  async function scrollToBottom() {
    await tick()
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }

  async function openChannel(id: number) {
    error = ''
    activeId = id
    open = true
    picking = false
    if (!loaded.has(id)) {
      try {
        messagesByCh = { ...messagesByCh, [id]: await fetchMessages(id) }
        loaded.add(id)
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
        return
      }
    }
    unread = { ...unread, [id]: 0 }
    await markRead(id).catch(() => {})
    await scrollToBottom()
  }

  async function send() {
    const body = input.trim()
    if (!body || activeId == null) return
    input = ''
    error = ''
    try {
      store(await sendMessage(activeId, body)) // optimistic; broadcast echo dedupes by id
      await scrollToBottom()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      input = body // restore so the user doesn't lose the text
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function togglePick(n: string) {
    pickerSel = pickerSel.includes(n) ? pickerSel.filter((x) => x !== n) : [...pickerSel, n]
  }

  async function startConversation() {
    if (pickerSel.length === 0) return
    error = ''
    try {
      const c = await getOrCreateChannel(gameId, pickerSel)
      if (!channels.some((x) => x.id === c.id)) channels = [...channels, c]
      await subscribeAll()
      pickerSel = []
      await openChannel(c.id)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  onMount(load)
  onDestroy(() => {
    for (const u of unsubs.values()) u()
    unsubs.clear()
  })
</script>

{#if nation}
  <div class="chat" class:open>
    {#if open}
      <div class="head">
        <strong>Press</strong>
        <button class="icon" title="New conversation" on:click={() => { picking = !picking; activeId = null }}>＋</button>
        <button class="icon" title="Minimise" on:click={() => (open = false)}>—</button>
      </div>

      <div class="cols">
        <div class="channels">
          {#each channels as c (c.id)}
            <button class="ch" class:active={c.id === activeId} on:click={() => openChannel(c.id)}>
              <span class="ch-name">{channelLabel(c)}</span>
              {#if unread[c.id]}<span class="badge">{unread[c.id]}</span>{/if}
            </button>
          {/each}
          {#if channels.length === 0}
            <p class="empty">No conversations yet.</p>
          {/if}
        </div>

        <div class="thread">
          {#if picking}
            <div class="picker">
              <p class="hint">Pick who to message. The same set always reopens the same private channel.</p>
              <div class="chips">
                {#each otherNations as n}
                  <button class="chip" class:on={pickerSel.includes(n)} on:click={() => togglePick(n)}>{display(n)}</button>
                {/each}
              </div>
              <button class="start" disabled={pickerSel.length === 0} on:click={startConversation}>
                Start conversation
              </button>
            </div>
          {:else if activeId != null}
            <div class="messages" bind:this={scroller}>
              {#each activeMessages as m (m.id)}
                <div class="msg" class:mine={m.sender === nation}>
                  {#if m.sender !== nation}<span class="from">{display(m.sender)}</span>{/if}
                  <span class="body">{m.body}</span>
                </div>
              {/each}
              {#if activeMessages.length === 0}<p class="empty">No messages yet — say something.</p>{/if}
            </div>
            <div class="compose">
              <textarea
                rows="1"
                placeholder="Message…"
                bind:value={input}
                on:keydown={onKey}
              ></textarea>
              <button class="send" on:click={send} disabled={!input.trim()}>Send</button>
            </div>
          {:else}
            <p class="empty pad">Select a conversation, or ＋ to start one.</p>
          {/if}
          {#if error}<p class="err">{error}</p>{/if}
        </div>
      </div>
    {:else}
      <button class="launcher" on:click={() => (open = true)}>
        Press
        {#if totalUnread}<span class="badge">{totalUnread}</span>{/if}
      </button>
    {/if}
  </div>
{/if}

<style>
  .chat {
    position: absolute;
    left: 16px;
    bottom: 16px;
    z-index: 20;
    font-size: 13px;
  }
  .launcher {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 999px;
    background: var(--accent, #3b82f6);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  }
  .chat.open {
    width: 380px;
    height: 440px;
    display: flex;
    flex-direction: column;
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border, #eee);
  }
  .head strong { flex: 1; }
  .icon {
    border: none;
    background: none;
    color: var(--text-secondary, #555);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 2px 6px;
  }
  .cols { flex: 1; display: flex; min-height: 0; }
  .channels {
    width: 130px;
    flex: none;
    border-right: 1px solid var(--border, #eee);
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ch {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    color: var(--text, #1a1a1a);
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 6px;
  }
  .ch:hover { background: var(--bg-hover, rgba(0, 0, 0, 0.05)); }
  .ch.active { background: var(--accent-subtle, #e0edff); color: var(--accent, #3b82f6); font-weight: 600; }
  .ch-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge {
    flex: none;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: #ef4444;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .thread { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .msg {
    max-width: 85%;
    padding: 6px 9px;
    border-radius: 10px;
    background: var(--bg-hover, #f1f3f5);
    align-self: flex-start;
    display: flex;
    flex-direction: column;
    gap: 1px;
    word-break: break-word;
  }
  .msg.mine { align-self: flex-end; background: var(--accent, #3b82f6); color: #fff; }
  .from { font-size: 11px; font-weight: 700; opacity: 0.8; }
  .compose {
    display: flex;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid var(--border, #eee);
  }
  .compose textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 8px;
    padding: 7px 9px;
    font: inherit;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
  }
  .send, .start {
    border: none;
    border-radius: 8px;
    background: var(--accent, #3b82f6);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
    padding: 0 14px;
  }
  .send:disabled, .start:disabled { opacity: 0.5; cursor: default; }
  .picker { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .hint { margin: 0; color: var(--text-secondary, #666); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    padding: 5px 10px;
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 999px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
  }
  .chip.on { background: var(--accent, #3b82f6); color: #fff; border-color: var(--accent, #3b82f6); }
  .start { padding: 8px 14px; align-self: flex-start; }
  .empty { color: var(--text-secondary, #888); margin: 0; }
  .empty.pad { padding: 14px; }
  .err { color: #dc2626; margin: 0; padding: 6px 10px; }
</style>
