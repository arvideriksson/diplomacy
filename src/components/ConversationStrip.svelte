<script lang="ts">
  // A narrow column of conversation avatars beside the open thread (single-pane layout on
  // a desktop rail), so the player can hop between negotiations without going back to
  // the list. Unread conversations carry a badge; the open one is ringed.
  import type { ChatStore, chatLabels } from '../lib/chatStore'
  import ChatAvatar from './ChatAvatar.svelte'

  export let chat: ChatStore
  export let labels: ReturnType<typeof chatLabels>
  /** The viewer's nation (left out of each avatar). */
  export let nation: string

  const { sortedConversations, activeId, activeDraftId, unread } = chat
  $: ({ others, channelLabel } = labels)
</script>

<nav class="strip" aria-label="Conversations">
  {#each $sortedConversations as c (c.kind + c.id)}
    {@const active = c.kind === 'channel' ? c.id === $activeId : c.id === $activeDraftId}
    {@const count = c.kind === 'channel' ? $unread[c.id] ?? 0 : 0}
    <button
      class="item"
      class:active
      title={channelLabel(c.conv)}
      aria-label="{channelLabel(c.conv)}{count ? `, ${count} unread` : ''}"
      aria-current={active ? 'true' : undefined}
      on:click={() => (c.kind === 'channel' ? chat.openChannel(c.id) : chat.openDraft(c.id))}
    >
      <ChatAvatar {labels} nations={others(c.conv).filter((n) => n !== nation)} isPublic={c.kind === 'channel' && c.conv.is_public} size={38} />
      {#if count}<span class="badge">{count > 99 ? '99+' : count}</span>{/if}
    </button>
  {/each}
</nav>

<style>
  .strip {
    flex: none;
    width: 60px;
    overflow-y: auto;
    padding: 8px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    border-right: 1px solid var(--border);
    scrollbar-width: none;
  }
  .item {
    position: relative;
    flex: none;
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    cursor: pointer;
  }
  .item:hover {
    background: var(--bg-hover);
  }
  .item.active {
    background: var(--accent-muted);
  }
  .item.active::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
  }
  .badge {
    position: absolute;
    top: 2px;
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
    box-shadow: 0 0 0 2px var(--bg-card);
  }
</style>
