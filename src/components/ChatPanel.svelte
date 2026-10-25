<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import type { PlayerInfo } from '../lib/game'
  import type { PowerDefinition } from '../lib/mapDefinition'
  import { chatLabels, createChatStore } from '../lib/chatStore'
  import ConversationList from './ConversationList.svelte'
  import NewConversationPicker from './NewConversationPicker.svelte'
  import ChatThread from './ChatThread.svelte'
  import { compact } from '../lib/layout'

  export let gameId: string
  /** The viewer's nation. Chat is unavailable without one (spectators get no press). */
  export let nation: string
  /** game.players — the set of nations actually in the game (possible recipients). */
  export let players: Record<string, PlayerInfo> = {}
  /** Map powers — supplies each nation's display name and color. */
  export let powers: PowerDefinition[] = []
  /** Total unread messages across conversations (for a tab badge). */
  export let onUnread: ((n: number) => void) | null = null

  let scroller: HTMLDivElement | null = null

  async function scrollToBottom() {
    await tick()
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }

  // All conversation state + loading/sending lives in the store (one per mounted panel).
  const chat = createChatStore(gameId, nation, scrollToBottom)
  const { picking, openChan, unread, activeId, activeDraftId } = chat
  $: onUnread?.(Object.values($unread).reduce((a, n) => a + (n || 0), 0))

  // Phones: one pane at a time — the list, or the open thread with a way back.
  function backToList() {
    if ($picking) chat.cancelPicking()
    else if ($activeDraftId != null) chat.toggleDraft($activeDraftId)
    else if ($activeId != null) chat.toggleChannel($activeId)
  }

  $: labels = chatLabels(powers, nation)
  $: myName = labels.display(nation)
  $: myColor = labels.colorOf(nation)

  $: otherNations = Object.values(players)
    .map((p) => p.nation)
    .filter((n): n is string => !!n && n !== nation)
    .sort((a, b) => labels.display(a).localeCompare(labels.display(b)))

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const onVisible = () => { if (document.visibilityState === 'visible') chat.refresh().catch(() => {}) }

  onMount(async () => {
    await chat.load()
    pollTimer = setInterval(() => chat.refresh().catch(() => {}), 8000)
    document.addEventListener('visibilitychange', onVisible)
  })
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
    document.removeEventListener('visibilitychange', onVisible)
    chat.destroy()
  })
</script>

{#if nation}
  <aside class="chat-sidebar">
    <!-- Country banner: the same .tone-banner as the right sidebar's phase banner,
         coloured by the nation — shaded tint fill, pure-colour text, 3px edge sliver. -->
    <div
      class="tone-banner"
      style="--tone: {myColor}; --tone-subtle: color-mix(in srgb, {myColor} 15%, transparent);"
    >
      {myName}
    </div>

    <!-- Two-pane press: persistent conversation list (left) + the open thread (right).
         Phones show one at a time. -->
    {#if $compact}
      <div class="panes single">
        {#if $picking || $openChan}
          <div class="thread-pane">
            <button class="back" on:click={backToList}>‹ Conversations</button>
            {#if $picking}
              <NewConversationPicker {chat} {labels} {otherNations} />
            {:else}
              <ChatThread {chat} {labels} {nation} bind:scroller />
            {/if}
          </div>
        {:else}
          <ConversationList {chat} {labels} {nation} wide />
        {/if}
      </div>
    {:else}
    <div class="panes">
      <ConversationList {chat} {labels} {nation} />

      <div class="thread-pane">
        {#if $picking}
          <NewConversationPicker {chat} {labels} {otherNations} />
        {:else if $openChan}
          <ChatThread {chat} {labels} {nation} bind:scroller />
        {:else}
          <!-- Nothing open: invite the player to pick a conversation. -->
          <div class="thread-empty">
            <p class="empty">Select a conversation, or start a new one.</p>
          </div>
        {/if}
      </div>
    </div>
    {/if}
  </aside>
{/if}

<style>
  /* Fills the host left rail (which supplies width, border, and background). */
  .chat-sidebar {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-size: 14px;
  }
  /* Two panes side by side: conversation list, then the open thread. */
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .back {
    flex: none;
    align-self: flex-start;
    min-height: 44px;
    padding: 0 14px;
    border: none;
    background: none;
    color: var(--accent);
    font: 600 15px var(--font);
    cursor: pointer;
  }
  .thread-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .thread-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
  }
  .empty {
    color: var(--text-secondary, #888);
    margin: 0;
  }
</style>
