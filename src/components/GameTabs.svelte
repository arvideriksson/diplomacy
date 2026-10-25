<script lang="ts">
  // Phones: the bottom tab bar of the game view — Press, Map, Orders.
  import type { GameTab } from '../lib/layout'
  import Icon from './Icon.svelte'

  export let tab: GameTab
  export let onSelect: (t: GameTab) => void
  /** Unread press messages. */
  export let pressBadge: number = 0
  /** Units still without an order (an amber count), or `done` once submitted. */
  export let ordersBadge: number = 0
  export let ordersDone: boolean = false
  /** Unsent changes to a submitted set (a blue count), 0 for none. */
  export let ordersDirty: number = 0

  const TABS: Array<{ id: GameTab; label: string }> = [
    { id: 'press', label: 'Press' },
    { id: 'map', label: 'Map' },
    { id: 'orders', label: 'Orders' },
  ]
</script>

<nav class="tabs" aria-label="Game sections">
  {#each TABS as t (t.id)}
    <button class="tab" class:on={tab === t.id} on:click={() => onSelect(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
      <span class="ico">
        <Icon name={t.id} size={24} round />
        {#if t.id === 'press' && pressBadge}
          <span class="badge">{pressBadge > 99 ? '99+' : pressBadge}</span>
        {:else if t.id === 'orders' && ordersDirty}
          <span class="badge unsent" aria-label="{ordersDirty} unsent">{ordersDirty}</span>
        {:else if t.id === 'orders' && ordersDone}
          <span class="badge done icon" aria-label="Submitted">
            <svg class="glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.4 5.2l1.8 1.8 3.6-3.8" /></svg>
          </span>
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
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 2px var(--bg-card);
  }
  .badge.icon {
    width: 18px;
    padding: 0;
  }
  /* "!" and "✓" drawn rather than typed, so they sit dead centre in the dot. */
  .badge .glyph {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .badge.todo {
    background: var(--amber);
  }
  .badge.unsent {
    background: var(--accent);
  }
  .badge.done {
    background: var(--green);
  }
</style>
