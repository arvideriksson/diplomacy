<script lang="ts">
  // The open conversation: title (double-click to rename; a draft can be discarded),
  // its messages, and the compose box. A draft shows the same shell but creates its DB
  // row on the first send.
  import { NAME_MAX, type ChatStore, type chatLabels } from '../lib/chatStore'

  export let chat: ChatStore
  export let labels: ReturnType<typeof chatLabels>
  /** The viewer's nation (own messages render as "mine"). */
  export let nation: string
  /** The message scroller, bound up so the panel can scroll to the newest message. */
  export let scroller: HTMLDivElement | null = null

  const { openChan, activeDraft, activeMessages, renaming, renameInput, renamable, input, error } = chat
  $: ({ display, colorOf, channelLabel, memberList } = labels)

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      chat.send()
    }
  }
</script>

{#if $openChan}
  <div class="thread">
    <div class="thread-head">
      {#if $renaming}
        <!-- svelte-ignore a11y-autofocus -->
        <input
          class="rename"
          autofocus
          maxlength={NAME_MAX}
          bind:value={$renameInput}
          on:keydown={(e) => { if (e.key === 'Enter') chat.submitRename(); if (e.key === 'Escape') renaming.set(false) }}
          on:blur={chat.submitRename}
        />
        {#if $renameInput.length >= NAME_MAX - 10}
          <span class="counter" class:full={$renameInput.length >= NAME_MAX}>{$renameInput.length}/{NAME_MAX}</span>
        {/if}
      {:else}
        <span class="thread-title">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="thread-name"
            class:renamable={$renamable}
            title={$renamable ? 'Double-click to rename' : null}
            on:dblclick={chat.startRename}
          >{channelLabel($openChan)}</span>
          {#if $openChan.name && memberList($openChan)}<span class="thread-sub">{memberList($openChan)}</span>{/if}
        </span>
        {#if $activeDraft}
          {@const draftId = $activeDraft.id}
          <button class="rename-btn" title="Discard draft" on:click={() => chat.discardDraft(draftId)}>🗑</button>
        {/if}
      {/if}
    </div>
    <div class="messages" bind:this={scroller}>
      {#each $activeMessages as m (m.id)}
        <div class="msg" class:mine={m.sender === nation}>
          {#if m.sender !== nation}
            <span class="from" style="color: {colorOf(m.sender)}">{display(m.sender)}</span>
          {/if}
          <span class="body">{m.body}</span>
        </div>
      {/each}
      {#if $activeMessages.length === 0}
        <p class="empty">{$activeDraft ? 'Draft — your first message starts this conversation.' : 'No messages yet — say something.'}</p>
      {/if}
    </div>
    <div class="compose">
      <textarea rows="1" placeholder="Message…" bind:value={$input} on:keydown={onKey} on:input={chat.onCompose}></textarea>
      <button class="btn btn-primary btn-sm" on:click={chat.send} disabled={!$input.trim()}>Send</button>
    </div>
    {#if $error}<p class="err">{$error}</p>{/if}
  </div>
{/if}

<style>
  .thread {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .thread-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border, #eee);
  }
  .thread-title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  /* Let a long conversation name wrap to two lines (then ellipsize) instead of
     truncating on the first line — the 60-char cap keeps this bounded. */
  .thread-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .thread-name.renamable {
    cursor: text;
  }
  .thread-name.renamable:hover {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .thread-sub {
    font-weight: 400;
    font-size: 11px;
    color: var(--text-secondary, #888);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename-btn {
    flex: none;
    border: none;
    background: none;
    color: var(--text-secondary, #888);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
  }
  .rename {
    flex: 1;
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 6px;
    padding: 5px 8px;
    font: inherit;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
  }
  /* Quiet near-limit hint: appears only in the last 10 chars, reddens at the cap. */
  .counter {
    align-self: flex-end;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--amber, #b45309);
  }
  .counter.full {
    color: #dc2626;
    font-weight: 600;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
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
  .msg.mine {
    align-self: flex-end;
    background: var(--accent, #3b82f6);
    color: #fff;
  }
  .from {
    font-size: 11px;
    font-weight: 700;
  }
  .compose {
    flex: none;
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
  .empty {
    color: var(--text-secondary, #888);
    margin: 0;
  }
  .err {
    color: #dc2626;
    margin: 0;
    padding: 6px 12px;
  }
</style>
