<script lang="ts">
  // The picked unit's (or supply center's) actions as a row of buttons at the bottom of
  // the map, clear of the board so they never cover a destination.
  import type { Action } from '../lib/orders/actions'
  import { unitTokenSvg, DEFAULT_UNIT_STYLE } from '../lib/map/unitStyles'

  export let items: Action[]
  export let onPick: (id: string) => void
</script>

<div class="bar" role="toolbar" aria-label="Actions">
  {#each items as b (b.id)}
    <button
      class="action"
      class:active={b.active}
      class:danger={b.tone === 'danger'}
      disabled={b.disabled}
      aria-pressed={b.active ?? false}
      on:click={() => onPick(b.id)}
    >
      {#if b.token}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <svg class="token" viewBox="0 0 32 32" aria-hidden="true">{@html unitTokenSvg(16, 16, b.token.type, b.token.color, 12, DEFAULT_UNIT_STYLE)}</svg>
      {:else if b.icon}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html b.icon}</svg>
      {/if}
      <span class="label">{b.label}</span>
      {#if b.key && !b.disabled}<kbd>{b.key}</kbd>{/if}
    </button>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    justify-content: center;
    gap: 14px;
    max-width: 100%;
    pointer-events: none;
  }
  .action {
    position: relative;
    flex: none;
    width: 60px;
    height: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--border-strong) 80%, transparent);
    background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: var(--text);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    font-family: var(--font);
    cursor: pointer;
    pointer-events: auto;
    transition: transform 0.1s ease, background 0.1s ease;
  }
  @media (hover: hover) {
    .action:hover:not(:disabled):not(.active) {
      background: color-mix(in srgb, var(--accent) 16%, var(--bg-elevated));
      border-color: var(--accent);
    }
  }
  .action:active:not(:disabled) {
    transform: scale(0.92);
  }
  .action.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .action.danger:not(.active) {
    color: var(--red);
  }
  .action.danger.active {
    background: var(--red);
    border-color: var(--red);
  }
  .action:disabled {
    cursor: default;
    color: var(--text-tertiary);
    background: color-mix(in srgb, var(--bg-elevated) 70%, transparent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }
  .icon {
    width: 20px;
    height: 20px;
  }
  .token {
    width: 28px;
    height: 28px;
  }
  .label {
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1.1;
    max-width: 54px;
    text-align: center;
  }
  kbd {
    position: absolute;
    top: -3px;
    right: -3px;
    font: 700 9.5px/1 var(--mono);
    padding: 3px 4px;
    border-radius: 5px;
    background: var(--bg-card);
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
  }
  /* Touch screens have no keyboard shortcuts to hint at. */
  @media (hover: none) {
    kbd {
      display: none;
    }
  }
</style>
