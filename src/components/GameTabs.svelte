<script lang="ts">
  // Phones: the bottom tab bar of the game view — Press, Map, Orders.
  import type { GameTab } from '../lib/layout'

  export let tab: GameTab
  export let onSelect: (t: GameTab) => void
  /** Unread press messages. */
  export let pressBadge: number = 0
  /** Units still without an order (an amber count), or `done` once submitted. */
  export let ordersBadge: number = 0
  export let ordersDone: boolean = false
  /** Edits made after submitting that aren't sent yet. */
  export let ordersDirty: boolean = false

  const TABS: Array<{ id: GameTab; label: string; icon: string }> = [
    { id: 'press', label: 'Press', icon: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />' },
    { id: 'map', label: 'Map', icon: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" />' },
    { id: 'orders', label: 'Orders', icon: '<path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />' },
  ]
</script>

<nav class="tabs" aria-label="Game sections">
  {#each TABS as t (t.id)}
    <button class="tab" class:on={tab === t.id} on:click={() => onSelect(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
      <span class="ico">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html t.icon}</svg>
        {#if t.id === 'press' && pressBadge}
          <span class="badge">{pressBadge > 99 ? '99+' : pressBadge}</span>
        {:else if t.id === 'orders' && ordersDirty}
          <span class="badge todo">!</span>
        {:else if t.id === 'orders' && ordersDone}
          <span class="badge done">✓</span>
        {:else if t.id === 'orders' && ordersBadge}
          <span class="badge todo">{ordersBadge}</span>
        {/if}
      </span>
      <span class="lbl">{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tabs {
    flex: none;
    display: flex;
    background: var(--bg-card);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
    position: relative;
    z-index: 30;
  }
  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 58px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    font: 600 11.5px var(--font);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .tab.on {
    color: var(--accent);
  }
  .ico {
    position: relative;
    width: 24px;
    height: 24px;
  }
  .ico svg {
    width: 24px;
    height: 24px;
  }
  .tab.on .ico::before {
    content: '';
    position: absolute;
    inset: -4px -14px;
    border-radius: 999px;
    background: var(--accent-subtle);
    z-index: -1;
  }
  .badge {
    position: absolute;
    top: -5px;
    left: 15px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: #ef4444;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
    box-shadow: 0 0 0 2px var(--bg-card);
  }
  .badge.todo {
    background: var(--amber);
  }
  .badge.done {
    background: var(--green);
  }
</style>
