<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { get } from 'svelte/store'
  import type { PlayerInfo } from '../lib/game'
  import type { PowerDefinition } from '../lib/mapDefinition'
  import { chatLabels, createChatStore } from '../lib/chatStore'
  import ConversationList from './ConversationList.svelte'
  import NewConversationPicker from './NewConversationPicker.svelte'
  import ChatThread from './ChatThread.svelte'
  import ConversationStrip from './ConversationStrip.svelte'
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
  let scrolledUp = false

  // Where the reader left each thread they had scrolled back in (channel id → scrollTop),
  // so popping out to check another conversation doesn't lose their place.
  const positions = new Map<number, number>()

  // Show the open thread's newest message — or, with `to` 'unread', its "new messages"
  // divider, or with 'focus' the message picked from search (briefly highlighted). A
  // thread with nothing new reopens where the reader left it.
  async function scrollToBottom(to?: 'unread' | 'focus') {
    await tick()
    if (!scroller) return
    const focusId = to === 'focus' ? get(chat.focusMsg) : null
    const target = focusId != null ? scroller.querySelector<HTMLElement>(`[data-msg="${focusId}"]`) : null
    if (to === 'focus') chat.focusMsg.set(null)
    if (target) {
      scroller.scrollTop = target.offsetTop - scroller.clientHeight / 3
      target.classList.add('flash')
      setTimeout(() => target.classList.remove('flash'), 1600)
      opening = false
      scrolledUp = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 48
      return
    }
    const divider = to === 'unread' ? scroller.querySelector<HTMLElement>('.new-divider') : null
    const saved = $activeId != null ? positions.get($activeId) : undefined
    if (divider) scroller.scrollTop = divider.offsetTop - 12
    else if (opening && saved != null && !to) scroller.scrollTop = saved
    else scroller.scrollTop = scroller.scrollHeight
    opening = false
    scrolledUp = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 48
    if (!scrolledUp && $activeId != null) positions.delete($activeId)
  }

  // All conversation state + loading/sending lives in the store (one per mounted panel).
  // A message in the open thread counts as read only if the reader can see it arrive.
  // (On phones the press pane stays mounted, just hidden, behind the Map/Orders tabs.)
  const isWatching = () =>
    document.visibilityState === 'visible' && !!scroller && !scrolledUp && !covered &&
    (scroller.checkVisibility?.({ visibilityProperty: true }) ?? true)
  /** The thread's details sheet covers the messages. */
  let covered = false
  const chat = createChatStore(gameId, nation, scrollToBottom, isWatching)
  const { picking, openChan, unread, activeId, activeDraftId } = chat
  $: onUnread?.(totalUnread)
  // Switching conversations: the next scroll may restore that thread's saved place.
  let opening = false
  $: onSwitch($activeId, $activeDraftId)
  function onSwitch(..._: unknown[]) {
    scrolledUp = false
    opening = true
  }

  // The thread scrolled: remember the place, and reading down to the end reads it.
  function onThreadScroll(top: number, atBottom: boolean) {
    if ($activeId == null) return
    if (atBottom) {
      positions.delete($activeId)
      if ($unread[$activeId]) chat.markSeen()
    } else {
      positions.set($activeId, top)
    }
  }

  // One pane at a time (list, or the open thread with a back arrow) on phones and
  // whenever the rail is too narrow to give a thread a comfortable reading width. A
  // narrow desktop rail keeps a strip of conversation avatars beside the thread.
  let width = 0
  $: single = $compact || width < 640
  $: strip = single && !$compact && width >= 420
  $: totalUnread = Object.values($unread).reduce((a, n) => a + (n || 0), 0)
  // Conversations with something unread — what navigation badges count.
  $: unreadChats = Object.values($unread).filter(Boolean).length

  // Back steps out one level: the details sheet first, then the thread itself.
  function backToList() {
    if (covered) {
      covered = false
      return
    }
    chat.cancelPicking()
    chat.closeAll()
  }

  $: labels = chatLabels(powers, nation, players)

  $: otherNations = Object.values(players)
    .map((p) => p.nation)
    .filter((n): n is string => !!n && n !== nation)
    .sort((a, b) => labels.display(a).localeCompare(labels.display(b)))

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const onVisible = () => { if (document.visibilityState === 'visible') chat.catchUp().catch(() => {}) }

  // Phones: the system back gesture steps out of a thread (or the new-conversation
  // screen) to the list, like a native messenger, via one history entry per visit.
  let pushed = false
  $: inside = $compact && ($picking || !!$openChan)
  $: syncHistory(inside)
  function syncHistory(on: boolean) {
    if (typeof history === 'undefined') return
    if (on && !pushed) {
      history.pushState({ ...history.state, pressThread: true }, '')
      pushed = true
    } else if (!on && pushed) {
      pushed = false
      if (history.state?.pressThread) history.back()
    }
  }
  function onPopState() {
    if (!pushed) return
    pushed = false
    backToList()
    if (inside) syncHistory(true) // only the details sheet closed; stay a level deep
  }

  onMount(async () => {
    window.addEventListener('popstate', onPopState)
    await chat.load().catch(() => {})
    // Local only, no fetch: back on the press tab at the end of an open thread, it has
    // now been seen. New channels arrive over Realtime (the store's inbox subscription).
    pollTimer = setInterval(() => {
      if ($activeId != null && $unread[$activeId] && isWatching()) chat.markSeen()
    }, 8000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
  })
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onVisible)
    window.removeEventListener('popstate', onPopState)
    if (pushed && history.state?.pressThread) history.back()
    chat.destroy()
  })
</script>

{#if nation}
  <aside class="chat-sidebar" bind:clientWidth={width}>
    <div class="panes" class:single>
      <!-- In single-pane mode the list stays mounted (just hidden) behind an open thread,
           so its search, filter and scroll position survive a look at another chat. -->
      <div class="list-slot" class:wide={single} hidden={single && ($picking || !!$openChan)}>
        <ConversationList {chat} {labels} {nation} wide={single} />
      </div>
      {#if strip && ($picking || $openChan)}
        <ConversationStrip {chat} {labels} {nation} />
      {/if}
      {#if !single || $picking || $openChan}
        <div class="thread-pane">
          {#if $picking}
            <NewConversationPicker {chat} {labels} {nation} {otherNations} onBack={single ? backToList : null} />
          {:else if $openChan}
            {#key $activeId ?? `draft:${$activeDraftId}`}
              <ChatThread
                {chat}
                {labels}
                {nation}
                bind:scroller
                bind:scrolledUp
                bind:details={covered}
                onBack={single ? backToList : null}
                backBadge={unreadChats}
                onScrolled={onThreadScroll}
              />
            {/key}
          {:else}
            <!-- Nothing open: invite the player to pick a conversation. -->
            <div class="thread-empty">
              <p class="empty">Select a conversation, or start a new one.</p>
              <button class="btn btn-sm" on:click={chat.startPicking}>New conversation</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
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
  .list-slot {
    flex: none;
    display: flex;
    min-height: 0;
  }
  .list-slot.wide {
    flex: 1;
    min-width: 0;
  }
  .list-slot[hidden] {
    display: none;
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
  .thread-empty {
    flex-direction: column;
    gap: 12px;
  }
  .empty {
    color: var(--text-secondary, #888);
    margin: 0;
  }
</style>
