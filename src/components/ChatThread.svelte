<script lang="ts">
  // The open conversation: a header (back, avatar, title, who's in it — tap it for the
  // details sheet listing every member, with rename and discard), the messages —
  // grouped by sender, with day separators, times and a "new messages" divider — and
  // the compose box. A draft shows the same shell but creates its DB row on the first
  // send. Keyed per conversation by the panel, so local state resets on switching.
  import { tick } from 'svelte'
  import { BODY_MAX, NAME_MAX, type ChatStore, type chatLabels } from '../lib/chatStore'
  import type { ChatMessage } from '../lib/chat'
  import { clockTime, dayLabel, sameDay } from '../lib/chatTime'
  import ChatAvatar from './ChatAvatar.svelte'
  import Icon from './Icon.svelte'

  export let chat: ChatStore
  export let labels: ReturnType<typeof chatLabels>
  /** The viewer's nation (own messages render as "mine"). */
  export let nation: string
  /** The message scroller, bound up so the panel can scroll to the newest message. */
  export let scroller: HTMLDivElement | null = null
  /** Single-pane layout: show a back arrow to the list. */
  export let onBack: (() => void) | null = null
  /** Whether the reader has scrolled away from the newest message. */
  export let scrolledUp = false
  /** Conversations with unread messages (shown on the back arrow). */
  export let backBadge = 0
  /** Reports each scroll: the position, and whether it reached the newest message. */
  export let onScrolled: ((top: number, atBottom: boolean) => void) | null = null

  const { openChan, active, activeId, activeDraft, activeMessages, renaming, renameInput, renamable, input, error, unread, unreadFrom, pending, pinned, hasOlder } = chat
  $: ({ display, who, userOf, others, isDirect, channelLabel } = labels)
  $: direct = $openChan ? isDirect($openChan) : false
  $: members = $openChan ? others($openChan) : []
  // Messages that arrived while scrolled up (counted on the jump button).
  $: newCount = $activeId != null ? $unread[$activeId] ?? 0 : 0
  // Other conversations with unread messages — what the back arrow's badge counts.
  $: elsewhere = backBadge - (newCount ? 1 : 0)
  $: sending = $activeId != null ? $pending[$activeId] ?? [] : []

  /** The details sheet (members, pin, rename, discard), drawn over the messages. */
  export let details = false

  // Runs of messages from one sender within a few minutes render as one group: the
  // sender's flag and name once, tighter spacing, and a tail only on the last bubble.
  const GROUP_GAP = 5 * 60_000
  type Row = { m: ChatMessage; day: string | null; first: boolean; last: boolean }
  $: rows = $activeMessages.map((m, i, all): Row => {
    const prev = all[i - 1]
    const next = all[i + 1]
    const joins = (a: ChatMessage | undefined, b: ChatMessage | undefined) =>
      !!a && !!b && a.sender === b.sender && sameDay(a.created_at, b.created_at) &&
      Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < GROUP_GAP
    return {
      m,
      day: !prev || !sameDay(prev.created_at, m.created_at) ? dayLabel(m.created_at) : null,
      first: !joins(prev, m) || m.id === $unreadFrom,
      last: !joins(m, next) || next?.id === $unreadFrom,
    }
  })

  // Grow the compose box with its text (up to ~5 lines) instead of clipping it.
  function autogrow(el: HTMLTextAreaElement, _value: string) {
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight + 2, 130)}px`
    }
    fit()
    return { update: fit }
  }

  // Touch keyboards have no Shift+Enter: there Return is a newline and Send sends.
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !coarse) {
      e.preventDefault()
      chat.send()
    }
  }

  function onScroll() {
    if (!scroller) return
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    scrolledUp = gap > 48
    // Only the true end counts as having read everything.
    onScrolled?.(scroller.scrollTop, gap < 4)
  }

  // When the thread's viewport changes height — an on-screen keyboard opening, the
  // compose box growing — keep the newest message pinned unless reading back.
  function stickToBottom(el: HTMLDivElement) {
    let lastHeight = el.clientHeight
    const ro = new ResizeObserver(() => {
      if (el.clientHeight < lastHeight && !scrolledUp) el.scrollTop = el.scrollHeight
      lastHeight = el.clientHeight
    })
    ro.observe(el)
    return { destroy: () => ro.disconnect() }
  }

  // Prepend the previous page of history, keeping the reader's place on screen.
  let loadingOlder = false
  async function showOlder() {
    if (!scroller || $activeId == null || loadingOlder) return
    loadingOlder = true
    const fromBottom = scroller.scrollHeight - scroller.scrollTop
    await chat.loadOlder($activeId).catch(() => 0)
    await tick()
    scroller.scrollTop = scroller.scrollHeight - fromBottom
    loadingOlder = false
  }

  // The details sheet takes focus while open and hands it back to its toggle on close.
  let detailsEl: HTMLDivElement | null = null
  let toggleEl: HTMLButtonElement | null = null
  async function toggleDetails() {
    details = !details
    await tick()
    if (details) detailsEl?.focus()
    else toggleEl?.focus()
  }

  function jumpToLatest() {
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }

  function rename() {
    chat.startRename()
  }
</script>

{#if $openChan}
  <div class="thread">
    <header class="thread-head">
      {#if onBack}
        <button class="icon-btn back" on:click={onBack} aria-label="Back to conversations" title="Back">
          <Icon name="back" size={22} strokeWidth={2.4} round />
          {#if elsewhere > 0}<span class="back-badge">{elsewhere > 99 ? '99+' : elsewhere}</span>{/if}
        </button>
      {/if}
      <button class="title-btn" on:click={toggleDetails} aria-expanded={details} title="Conversation details">
        <ChatAvatar {labels} nations={members} isPublic={!!$openChan.is_public} size={38} />
        <span class="thread-title">
          <span class="thread-name">{channelLabel($openChan)}</span>
          <span class="thread-sub">
            {#if $openChan.is_public}
              Everyone in the game
            {:else if direct && $openChan.name}
              {who(members[0])} · {display(members[0])}
            {:else if direct}
              {display(members[0])}
            {:else}
              {members.length + 1} members · {members.map(who).join(', ')}
            {/if}
          </span>
        </span>
      </button>
      <button class="icon-btn" class:on={details} bind:this={toggleEl} on:click={toggleDetails} aria-label="Conversation details" aria-expanded={details} title="Conversation details">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
    </header>

    <div class="body-area">
    {#if details}
      <div class="details" bind:this={detailsEl} tabindex="-1" role="region" aria-label="Conversation details">
        {#if $renaming}
          <div class="rename-row">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="rename"
              autofocus
              maxlength={NAME_MAX}
              placeholder="Conversation name"
              aria-label="Conversation name"
              bind:value={$renameInput}
              on:keydown={(e) => { if (e.key === 'Enter') chat.submitRename(); if (e.key === 'Escape') renaming.set(false) }}
            />
            <button class="btn btn-primary btn-sm" on:click={chat.submitRename}>Save</button>
          </div>
          {#if $renameInput.length >= NAME_MAX - 10}
            <span class="counter" class:full={$renameInput.length >= NAME_MAX}>{$renameInput.length}/{NAME_MAX}</span>
          {/if}
        {:else if $renamable}
          <button class="action" on:click={rename}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            {$openChan.name ? 'Rename conversation' : 'Name this conversation'}
          </button>
        {/if}
        {#if $active}
          {@const id = $active.id}
          <button class="action" on:click={() => chat.togglePin(id)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" /></svg>
            {$pinned.includes(id) ? 'Unpin from top of list' : 'Pin to top of list'}
          </button>
        {/if}
        <h3>{$openChan.is_public ? 'Everyone in the game' : `${members.length + 1} members`}</h3>
        <ul class="members">
          {#each [nation, ...members] as n (n)}
            <li>
              <ChatAvatar {labels} nations={[n]} size={36} />
              <span class="who">
                <span class="name">{userOf(n) ?? display(n)}{#if n === nation}<span class="you"> (you)</span>{/if}</span>
                {#if userOf(n)}<span class="nation">{display(n)}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
        {#if $activeDraft}
          {@const draftId = $activeDraft.id}
          <button class="action danger" on:click={() => chat.discardDraft(draftId)}>
            <Icon name="trash" size={18} round />
            Discard draft
          </button>
        {/if}
      </div>
    {/if}
      <div class="viewport" inert={details}>
      <div class="messages" bind:this={scroller} on:scroll={onScroll} use:stickToBottom>
        {#if $activeId != null && $hasOlder[$activeId]}
          <button class="older" on:click={showOlder} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : 'Load earlier messages'}
          </button>
        {/if}
        {#each rows as { m, day, first, last } (m.id)}
          {@const mine = m.sender === nation}
          {#if day}<div class="day"><span>{day}</span></div>{/if}
          {#if m.id === $unreadFrom}<div class="new-divider"><span>New messages</span></div>{/if}
          <div class="row" class:mine class:first class:last data-msg={m.id}>
            {#if !mine && !direct}
              <span class="gutter">
                {#if last}<ChatAvatar {labels} nations={[m.sender]} size={28} />{/if}
              </span>
            {/if}
            <div class="bubble">
              {#if first && !mine && !direct}
                <span class="from">
                  <span class="name">{userOf(m.sender) ?? display(m.sender)}</span>
                  {#if userOf(m.sender)}<span class="nation">{display(m.sender)}</span>{/if}
                </span>
              {/if}
              <span class="body">{m.body}<span class="spacer" aria-hidden="true"></span></span>
              <time class="time" datetime={m.created_at}>{clockTime(m.created_at)}</time>
            </div>
          </div>
        {:else}
          {#if sending.length === 0}
          <div class="thread-empty">
            <ChatAvatar {labels} nations={members} isPublic={!!$openChan.is_public} size={64} />
            <p class="empty-title">{channelLabel($openChan)}</p>
            <p class="empty-sub">
              {$activeDraft ? 'Your first message starts this conversation.' : 'No messages yet — say hello.'}
            </p>
          </div>
          {/if}
        {/each}
        {#each sending as p (p.key)}
          <div class="row mine first last pending" class:failed={p.failed}>
            <div class="bubble">
              <span class="body">{p.body}<span class="spacer" aria-hidden="true"></span></span>
              <span class="time">{p.failed ? '' : 'Sending…'}</span>
            </div>
          </div>
          {#if p.failed}
            <div class="failed-note" role="alert">
              Not sent.
              <button class="link" on:click={() => chat.retry($activeId ?? 0, p.key)}>Retry</button>
              <button class="link" on:click={() => chat.dropPending($activeId ?? 0, p.key)}>Delete</button>
            </div>
          {/if}
        {/each}
      </div>

      {#if scrolledUp}
        <button class="jump" on:click={jumpToLatest} aria-label={newCount ? `${newCount} new messages — jump to latest` : 'Jump to latest message'}>
          <Icon name="chevron-down" size={20} strokeWidth={2.4} round />
          {#if newCount}<span class="jump-count">{newCount}</span>{/if}
        </button>
      {/if}
      </div>

      {#if $error}<p class="err">{$error}</p>{/if}
      {#if $input.length >= BODY_MAX - 500}
        <span class="counter body-counter" class:full={$input.length >= BODY_MAX}>{$input.length}/{BODY_MAX}</span>
      {/if}
      <div class="compose" inert={details}>
        <textarea
          rows="1"
          maxlength={BODY_MAX}
          enterkeyhint={coarse ? 'enter' : 'send'}
          placeholder={direct ? `Message ${who(members[0])}` : 'Message'}
          aria-label="Message"
          bind:value={$input}
          use:autogrow={$input}
          on:keydown={onKey}
          on:input={chat.onCompose}
        ></textarea>
        <button class="send" on:click={chat.send} disabled={!$input.trim()} aria-label="Send" title="Send">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .thread {
    /* Incoming bubbles: a tint of the text colour over the panel, visible in both themes.
       Outgoing: a deep blue that keeps white text above 4.5:1 in both themes (the dark
       theme's accent is too pale for that). */
    --bubble-in: color-mix(in srgb, var(--text) 8%, var(--bg-card));
    --bubble-out: #2563eb;
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .thread-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 60px;
    padding: 8px 8px 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .thread-head:has(.back) {
    padding-left: 2px;
  }
  .icon-btn {
    flex: none;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover,
  .icon-btn.on {
    background: var(--bg-hover);
    color: var(--text);
  }
  .icon-btn.back {
    position: relative;
    color: var(--accent);
  }
  .back-badge {
    position: absolute;
    top: 4px;
    right: 0;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 10.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
  }
  .title-btn {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 2px 6px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .title-btn:hover {
    background: var(--bg-hover);
  }
  .thread-title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .thread-name {
    font-weight: 650;
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .thread-sub {
    font-size: 12.5px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .body-area {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* Drawn over the messages (which stay mounted, keeping their scroll position). */
  .details {
    position: absolute;
    inset: 0;
    z-index: 2;
    background: var(--bg-card);
    overflow-y: auto;
    padding: 12px 12px calc(16px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .details h3 {
    margin: 10px 4px 0;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
  }
  .members {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .members li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 6px 4px;
  }
  .who {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .who .name {
    font-weight: 600;
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  .who .you {
    font-weight: 400;
    color: var(--text-secondary);
  }
  .who .nation {
    font-size: 13px;
    color: var(--text-secondary);
  }
  .action {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-hover);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .action.danger {
    margin-top: 8px;
    color: var(--red);
  }
  .rename-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 44px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    padding: 0 12px;
    font: inherit;
    font-size: 16px;
    background: var(--bg-input);
    color: var(--text);
    outline: none;
  }
  .rename-row .btn {
    height: 44px;
  }
  /* Quiet near-limit hint: appears only near the cap (last 10 chars of a name, last
     500 of a message), reddens at it. */
  .counter {
    align-self: flex-end;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--amber);
  }
  .counter.full {
    color: var(--red);
    font-weight: 600;
  }
  .body-counter {
    flex: none;
    padding: 4px 16px 0;
  }

  /* The scrolling messages plus the floating jump button, above the compose box. */
  .viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px 12px 8px;
    display: flex;
    flex-direction: column;
  }
  /* Push a short conversation to the bottom, next to the compose box. */
  .messages > :first-child {
    margin-top: auto;
  }
  .older {
    align-self: center;
    min-height: 40px;
    padding: 0 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .details:focus {
    outline: none;
  }
  .day {
    display: flex;
    justify-content: center;
    margin: 14px 0 8px;
  }
  .day span {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bubble-in);
    padding: 3px 10px;
    border-radius: var(--radius-full);
  }
  .new-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px 0 2px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
  }
  .new-divider::before,
  .new-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    margin-top: 2px;
  }
  .row.first {
    margin-top: 10px;
  }
  .row.mine {
    justify-content: flex-end;
  }
  .gutter {
    flex: none;
    width: 28px;
  }
  .bubble {
    position: relative;
    max-width: min(80%, 520px);
    padding: 7px 11px 6px;
    border-radius: 18px;
    background: var(--bubble-in);
    color: var(--text);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  /* Corners: square off where a bubble meets its neighbours in a group. */
  .row:not(.mine):not(.first) .bubble {
    border-top-left-radius: 6px;
  }
  .row:not(.mine):not(.last) .bubble {
    border-bottom-left-radius: 6px;
  }
  .row.mine:not(.first) .bubble {
    border-top-right-radius: 6px;
  }
  .row.mine:not(.last) .bubble {
    border-bottom-right-radius: 6px;
  }
  .row.mine .bubble {
    background: var(--bubble-out);
    color: #fff;
  }
  .from {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 6px;
    font-size: 12.5px;
    min-width: 0;
  }
  .from .name {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .from .nation {
    flex: none;
    color: var(--text-secondary);
    font-size: 11.5px;
  }
  .body {
    font-size: 15px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* Reserves room on the last line so the time can float into the corner. */
  .spacer {
    display: inline-block;
    width: 44px;
  }
  .time {
    position: absolute;
    right: 10px;
    bottom: 5px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  /* A message brought into view from search. */
  .row:global(.flash) .bubble {
    animation: flash 1.6s ease-out;
  }
  @keyframes flash {
    0%,
    40% {
      box-shadow: 0 0 0 3px var(--amber);
    }
    100% {
      box-shadow: 0 0 0 3px transparent;
    }
  }
  .row.mine .time {
    color: rgba(255, 255, 255, 0.85);
  }

  .pending .bubble {
    opacity: 0.7;
  }
  .pending.failed .bubble {
    opacity: 1;
    background: color-mix(in srgb, var(--red) 75%, var(--bg-card));
  }
  .failed-note {
    align-self: flex-end;
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 12.5px;
    color: var(--red);
  }
  .failed-note {
    gap: 8px;
  }
  .failed-note .link {
    min-height: 44px;
    min-width: 44px;
    padding: 0 10px;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .thread-empty {
    margin: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
  }
  .empty-title {
    margin: 8px 0 0;
    font-weight: 650;
    font-size: 16px;
  }
  .empty-sub {
    margin: 0;
    max-width: 280px;
    color: var(--text-secondary);
    font-size: 13.5px;
  }

  .jump {
    position: absolute;
    right: 14px;
    bottom: 12px;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: var(--shadow-md);
    cursor: pointer;
  }
  .jump-count {
    position: absolute;
    top: -6px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 11px;
    font-weight: 700;
    display: grid;
    place-items: center;
  }

  .compose {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--border);
  }
  .compose textarea {
    flex: 1;
    min-height: 44px;
    line-height: 1.4;
    resize: none;
    border: 1px solid var(--border-strong);
    border-radius: 22px;
    padding: 11px 16px;
    font: inherit;
    font-size: 15px;
    background: var(--bg-input);
    color: var(--text);
    outline: none;
  }
  .compose textarea:focus {
    border-color: var(--accent);
  }
  /* 16px keeps iOS Safari from zooming in when the box takes focus. */
  @media (pointer: coarse) {
    .compose textarea {
      font-size: 16px;
    }
  }
  .send {
    flex: none;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: var(--bubble-out);
    color: #fff;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.15s;
  }
  .send:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .send:not(:disabled):active {
    transform: scale(0.92);
  }
  .err {
    color: var(--red);
    margin: 0;
    padding: 6px 14px;
    font-size: 13px;
  }
</style>
