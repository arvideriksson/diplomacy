<script lang="ts">
  // Press list pane: "+ New", then the viewer's conversations (channels with unread
  // badges, then unsent drafts), each headed by its other members' flag roundels.
  import type { ChatStore, chatLabels } from '../lib/chatStore'

  export let chat: ChatStore
  export let labels: ReturnType<typeof chatLabels>
  /** The viewer's nation (left out of each conversation's roundels). */
  export let nation: string

  const { channels, drafts, activeId, activeDraftId, unread, picking } = chat
  $: ({ display, colorOf, flagOf, channelLabel } = labels)
</script>

<!-- Overlapping flag roundels for a conversation's other members. -->
{#snippet flagRow(members: string[])}
  <span class="ch-flags">
    {#each members.filter((n) => n !== nation) as m}
      {#if flagOf(m)}
        <img class="roundel" src={flagOf(m)} alt={display(m)} title={display(m)} />
      {:else}
        <span class="roundel dot" style="background: {colorOf(m)}" title={display(m)}></span>
      {/if}
    {/each}
  </span>
{/snippet}

<div class="list-pane">
  <button class="new" class:on={$picking} on:click={chat.startPicking}>
    ＋ New
  </button>
  <div class="channels">
    {#each $channels as c (c.id)}
      <button class="ch" class:active={c.id === $activeId} on:click={() => chat.toggleChannel(c.id)}>
        {@render flagRow(c.members)}
        <span class="ch-row">
          <span class="ch-name">{channelLabel(c)}</span>
          {#if $unread[c.id]}<span class="unread">{$unread[c.id]}</span>{/if}
        </span>
      </button>
    {/each}
    {#each $drafts as d (d.id)}
      <!-- Draft: created in the shared DB only once its first message is sent. -->
      <button class="ch" class:active={d.id === $activeDraftId} on:click={() => chat.toggleDraft(d.id)}>
        {@render flagRow(d.members)}
        <span class="ch-row">
          <span class="ch-name">{channelLabel(d)}</span>
          <span class="draft-tag">draft</span>
        </span>
      </button>
    {/each}
    {#if $channels.length === 0 && $drafts.length === 0}<p class="empty">No conversations yet.</p>{/if}
  </div>
</div>

<style>
  .list-pane {
    flex: none;
    width: 200px;
    border-right: 1px solid var(--border, #eee);
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .new {
    border: 1px dashed var(--border-strong, #cbd5e1);
    background: none;
    color: var(--accent, #3b82f6);
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    font-weight: 600;
  }
  .new.on {
    background: var(--accent-subtle, #e0edff);
    border-style: solid;
    border-color: var(--accent, #3b82f6);
  }
  .channels {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ch {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    color: var(--text, #1a1a1a);
    cursor: pointer;
    padding: 10px 10px;
    border-radius: 8px;
  }
  .ch:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  }
  .ch.active {
    background: var(--accent-subtle, #e0edff);
    color: var(--accent, #3b82f6);
    font-weight: 600;
  }
  .ch-flags {
    display: inline-flex;
  }
  .ch-flags .roundel {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
    margin-left: -7px;
    box-shadow: 0 0 0 2px var(--bg-card, #fff);
  }
  .ch-flags .roundel:first-child {
    margin-left: 0;
  }
  .ch-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* "draft" tag on the pending (uncreated) conversation row. */
  .draft-tag {
    flex: none;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent, #3b82f6) 18%, transparent);
    color: var(--accent, #3b82f6);
  }
  .ch-name {
    flex: 1;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unread {
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
  .empty {
    color: var(--text-secondary, #888);
    margin: 0;
  }
</style>
