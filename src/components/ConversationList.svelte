<script lang="ts">
  // Press list pane: a "Press" header with a compose button, then every conversation
  // (channels and unsent drafts), most recent first — each with its flag avatar, title,
  // last message preview, time and unread count, like any messenger's inbox.
  import type { ChatStore, chatLabels } from '../lib/chatStore'
  import type { ChatMessage } from '../lib/chat'
  import { createDebouncer } from '../lib/debounce'
  import { listTime } from '../lib/chatTime'
  import ChatAvatar from './ChatAvatar.svelte'

  export let chat: ChatStore
  export let labels: ReturnType<typeof chatLabels>
  /** The viewer's nation (left out of each conversation's avatar). */
  export let nation: string
  /** Fill the width (single-pane layout, where the list is the whole pane). */
  export let wide: boolean = false

  const { sortedConversations: conversations, channels, activeId, activeDraftId, unread, unsent, pinned, pending, picking, status } = chat
  $: ({ display, who, others, channelLabel } = labels)

  // Find a conversation by its name or any member's username or nation; or show only
  // the ones with unread messages.
  let query = ''
  let onlyUnread = false
  $: q = query.trim().toLowerCase()
  $: shown = $conversations.filter((c) => {
    if (onlyUnread && !(c.kind === 'channel' && $unread[c.id])) return false
    if (!q) return true
    const words = [channelLabel(c.conv), ...others(c.conv).flatMap((n) => [who(n), display(n)])]
    return words.some((w) => w.toLowerCase().includes(q))
  })

  // Message search: what was said, not just who to — results jump into the thread.
  let found: ChatMessage[] = []
  let searched = ''
  let searching = false
  let searchFailed = false
  const runSearch = createDebouncer(async (term: string) => {
    try {
      const res = await chat.search(term)
      if (term !== query.trim()) return
      found = res
      searchFailed = false
    } catch {
      if (term !== query.trim()) return
      found = []
      searchFailed = true
    }
    searched = term
    searching = false
  }, 300)
  $: onQuery(q)
  function onQuery(term: string) {
    // Results for an older query are dropped at once rather than shown as current.
    found = []
    searchFailed = false
    if (term.length >= 2) {
      searching = true
      runSearch.schedule(query.trim())
    } else {
      runSearch.cancel()
      searching = false
      searched = ''
    }
  }
  $: hits = onlyUnread ? found.filter((m) => $unread[m.channel_id]) : found
  $: channelOf = (id: number) => $channels.find((c) => c.id === id)

  // Split a message around the search term so the match can be highlighted.
  function around(body: string, term: string): [string, string, string] {
    const i = body.toLowerCase().indexOf(term.toLowerCase())
    if (i < 0) return [body, '', '']
    const start = Math.max(0, i - 24)
    return [(start > 0 ? '…' : '') + body.slice(start, i), body.slice(i, i + term.length), body.slice(i + term.length)]
  }
  $: unreadTotal = Object.values($unread).filter(Boolean).length

  // The row a tap started on. A catch-up can reorder the list mid-tap (on iOS, right
  // after the app resumes), and the click then lands on whichever row moved under the
  // finger; open the one that was touched instead.
  let pressed: { kind: 'channel' | 'draft'; id: number } | null = null
  function open(c: { kind: 'channel' | 'draft'; id: number }) {
    const { kind, id } = pressed ?? c
    pressed = null
    if (kind === 'channel') chat.toggleChannel(id)
    else chat.toggleDraft(id)
  }

  // The preview line: "You: …" for my own message, "Name: …" in a group, and "Draft: …"
  // for text typed but not sent.
  function preview(c: (typeof $conversations)[number]): { from: string; text: string; draft?: boolean; sender?: string } {
    if (c.kind === 'draft') return { from: 'Draft', text: c.conv.body || 'No messages yet', draft: true }
    const failed = $pending[c.id]?.find((p) => p.failed)
    if (failed) return { from: 'Not sent', text: failed.body, draft: true }
    const typed = c.id !== $activeId ? $unsent[c.id] : undefined
    if (typed) return { from: 'Draft', text: typed, draft: true }
    if (!c.last) return { from: '', text: 'No messages yet' }
    const from = c.last.sender === nation ? 'You' : labels.isDirect(c.conv) ? '' : who(c.last.sender)
    return { from, text: c.last.body, sender: from && from !== 'You' ? c.last.sender : undefined }
  }
</script>

<div class="list-pane" class:wide>
  <header class="list-head">
    <h2>Press</h2>
    <button class="compose-btn" class:on={$picking} on:click={chat.startPicking} title="New conversation" aria-label="New conversation" data-test="new-chat">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /><path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L12 14.6 8 16l1.4-4z" />
      </svg>
    </button>
  </header>
  {#if $conversations.length > 0}
    <div class="tools">
      <label class="search">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input type="search" placeholder="Search players, groups or messages" aria-label="Search conversations" bind:value={query} />
      </label>
      <div class="filters" role="group" aria-label="Filter">
        <button class="filter" class:on={!onlyUnread} aria-pressed={!onlyUnread} on:click={() => (onlyUnread = false)}>All</button>
        <button class="filter" class:on={onlyUnread} aria-pressed={onlyUnread} on:click={() => (onlyUnread = true)}>
          Unread chats{#if unreadTotal}<span class="filter-count">{unreadTotal}</span>{/if}
        </button>
      </div>
    </div>
  {/if}
  <div class="rows">
    {#each shown as c (c.kind + c.id)}
      {@const active = c.kind === 'channel' ? c.id === $activeId : c.id === $activeDraftId}
      {@const count = c.kind === 'channel' ? $unread[c.id] ?? 0 : 0}
      {@const p = preview(c)}
      <button
        class="row"
        class:active
        class:unread={count > 0}
        on:pointerdown={() => (pressed = { kind: c.kind, id: c.id })}
        on:pointercancel={() => (pressed = null)}
        on:click={() => open(c)}
      >
        <ChatAvatar {labels} nations={others(c.conv)} isPublic={c.kind === 'channel' && c.conv.is_public} />
        <span class="text">
          <span class="line">
            <span class="title">{channelLabel(c.conv)}</span>
            {#if c.kind === 'channel' && $pinned.includes(c.id)}
              <svg class="pin" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-label="Pinned"><path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" /></svg>
            {/if}
            {#if c.kind === 'channel' && c.last}<span class="time">{listTime(c.at)}</span>{/if}
          </span>
          <span class="line">
            <span class="preview" class:draft={p.draft}>
              {#if p.sender}<ChatAvatar {labels} nations={[p.sender]} size={15} />{/if}
              {#if p.from}<span class="from">{p.from}:</span>{/if}
              <span class="msg">{p.text}</span>
            </span>
            {#if count}<span class="badge" aria-label="{count} unread">{count > 99 ? '99+' : count}</span>{/if}
          </span>
        </span>
      </button>
    {:else}
      {#if hits.length || searching}
        <!-- No conversation matched by name; message results follow (or are loading). -->
      {:else if $status === 'loading'}
        <p class="empty">Loading conversations…</p>
      {:else if $status === 'error'}
        <div class="empty">
          <p>Couldn’t load your conversations.</p>
          <button class="btn btn-sm" on:click={() => chat.load().catch(() => {})}>Try again</button>
        </div>
      {:else if searchFailed}
        <p class="empty">Search failed — check your connection.</p>
      {:else if $conversations.length}
        <p class="empty">{onlyUnread && !q ? 'You’re all caught up.' : `No conversations match “${query.trim()}”.`}</p>
      {:else}
        <div class="empty">
          <p class="empty-title">No conversations yet</p>
          <p>Message another player privately, form a group, or post to everyone in public press.</p>
          <button class="btn btn-primary" on:click={chat.startPicking}>Start a conversation</button>
        </div>
      {/if}
    {/each}
    {#if searching && q.length >= 2}
      <p class="searching">Searching messages…</p>
    {:else if hits.length}
      <h3 class="section">Messages</h3>
      {#each hits as m (m.id)}
        {@const ch = channelOf(m.channel_id)}
        {#if ch}
          {@const [pre, match, post] = around(m.body, searched)}
          <button class="row hit" on:click={() => chat.openAt(m.channel_id, m.id)}>
            <ChatAvatar {labels} nations={others(ch)} isPublic={ch.is_public} size={36} />
            <span class="text">
              <span class="line">
                <span class="title">{channelLabel(ch)}</span>
                <span class="time">{listTime(m.created_at)}</span>
              </span>
              <span class="snippet">
                <span class="from">{m.sender === nation ? 'You' : who(m.sender)}:</span>
                {pre}<mark>{match}</mark>{post}
              </span>
            </span>
          </button>
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .list-pane {
    flex: none;
    width: 260px;
    min-width: 0;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .list-pane.wide {
    flex: 1 1 0;
    width: auto;
    border-right: none;
  }
  .list-head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 6px 16px;
    min-height: 52px;
  }
  .list-head h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }
  .compose-btn {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: var(--bg-hover);
    color: var(--text);
    cursor: pointer;
  }
  .compose-btn:hover,
  .compose-btn.on {
    background: var(--accent-muted);
    color: var(--accent);
  }
  .tools {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 12px 8px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
    color: var(--text-tertiary);
  }
  .search:focus-within {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    outline: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
  }
  @media (pointer: coarse) {
    .search input {
      font-size: 16px;
    }
  }
  .filters {
    display: flex;
    gap: 6px;
  }
  .filter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  /* Compact pill, full-height touch target. */
  .filter {
    position: relative;
  }
  .filter::after {
    content: '';
    position: absolute;
    inset: -6px 0;
  }
  .filter.on {
    background: var(--accent-muted);
    border-color: transparent;
    color: var(--accent);
  }
  .filter-count {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 11px;
    display: inline-grid;
    place-items: center;
  }
  .rows {
    flex: 1;
    overflow-y: auto;
    padding: 0 6px 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 64px;
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.active {
    background: var(--accent-muted);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .searching {
    margin: 12px 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .section {
    margin: 14px 10px 4px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
  }
  .row.hit {
    align-items: flex-start;
  }
  .snippet {
    font-size: 13.5px;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .snippet .from {
    max-width: none;
  }
  mark {
    background: color-mix(in srgb, var(--amber) 35%, transparent);
    color: var(--text);
    border-radius: 3px;
    padding: 0 1px;
  }
  .pin {
    flex: none;
    color: var(--text-tertiary);
  }
  .time {
    flex: none;
    font-size: 12px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .preview {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13.5px;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  /* The sender gets at most ~40% so a long username never hides the message itself. */
  .from {
    flex: 0 1 auto;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-secondary);
    font-weight: 500;
  }
  .msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .preview.draft .from {
    color: var(--red);
  }
  .row.unread .title,
  .row.unread .msg {
    color: var(--text);
  }
  .row.unread .time {
    color: var(--accent);
    font-weight: 600;
  }
  .badge {
    flex: none;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 11.5px;
    font-weight: 700;
    display: inline-grid;
    place-items: center;
  }
  .empty {
    padding: 32px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--text-secondary);
    text-align: center;
  }
  .empty p {
    margin: 0;
    max-width: 300px;
    font-size: 14px;
  }
  .empty .empty-title {
    color: var(--text);
    font-weight: 650;
    font-size: 16px;
  }
</style>
