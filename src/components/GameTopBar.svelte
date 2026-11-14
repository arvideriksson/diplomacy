<script lang="ts">
  // Phones: the one header shared by every tab — leave, the game's name over the
  // season/phase (with ‹ › history steps), the countdown, and slotted actions. A sandbox
  // tints it and names itself so it can never be mistaken for the real game.
  import Icon from './Icon.svelte'
  import Countdown from './Countdown.svelte'
  import { phaseLabel, roundSeason } from '../lib/phases'

  export let title: string = ''
  export let phase: string
  export let season: string
  export let year: number
  export let onExit: (() => void) | null = null
  /** Label beside the back chevron (e.g. "Game" when it leads out of a sandbox). */
  export let exitLabel: string = ''
  export let onPhaseBack: (() => void) | null = null
  export let onPhaseForward: (() => void) | null = null
  export let canPhaseBack: boolean = false
  export let canPhaseForward: boolean = false
  /** True while viewing a past phase (history). */
  export let past: boolean = false
  export let deadline: string | null = null
  export let graceEndsAt: string | null = null
  export let sandbox: boolean = false
</script>

<header class="top" class:sandbox>
  {#if onExit}
    <button class="icon-btn exit" on:click={onExit} aria-label={exitLabel || 'Leave game'}>
      <Icon name={exitLabel ? 'back' : 'home'} size={20} strokeWidth={2.4} round />
      {#if exitLabel}<span class="exit-label">{exitLabel}</span>{/if}
    </button>
  {/if}
  <div class="mid">
    <span class="title">
      {#if sandbox}<span class="sb-tag">Sandbox</span>{/if}
      {title}
    </span>
    <span class="when" class:nav={onPhaseBack || onPhaseForward}>
      {#if onPhaseBack}
        <button class="step" on:click={onPhaseBack} disabled={!canPhaseBack} aria-label="Previous phase"><Icon name="back" size={18} strokeWidth={2.4} round /></button>
      {:else if onPhaseForward}<span></span>{/if}
      <span class="when-text" class:past>{roundSeason({ season, phase })} {year} · {phaseLabel(phase)}</span>
      {#if onPhaseForward}
        <button class="step" on:click={onPhaseForward} disabled={!canPhaseForward} aria-label="Next phase"><Icon name="chevron-right" size={18} strokeWidth={2.4} round /></button>
      {:else if onPhaseBack}<span></span>{/if}
    </span>
  </div>
  <div class="right">
    <Countdown {deadline} {graceEndsAt} pill />
    <slot />
  </div>
</header>

<style>
  .top {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 56px;
    padding: 6px 10px;
    padding-top: calc(6px + env(safe-area-inset-top));
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    position: relative;
    z-index: 30;
  }
  .top.sandbox {
    background: color-mix(in srgb, var(--amber) 14%, var(--bg-card));
    border-bottom-color: color-mix(in srgb, var(--amber) 45%, transparent);
  }
  .icon-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 40px;
    height: 40px;
    padding: 0 6px;
    border: none;
    border-radius: 10px;
    background: none;
    color: var(--text);
    font: 600 14px var(--font);
    cursor: pointer;
  }
  .icon-btn:active {
    background: var(--bg-hover);
  }
  .exit-label {
    padding-right: 2px;
  }
  .mid {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.2;
  }
  .title {
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sb-tag {
    flex: none;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--amber);
    color: #fff;
  }
  .when {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  /* Steps pinned at fixed spots, so stepping through phases with labels of different
     lengths never moves them under the thumb. */
  .when.nav {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) 30px;
    align-items: center;
    width: min(100%, 250px);
  }
  .when.nav .when-text {
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .when-text {
    font-size: 14.5px;
    font-weight: 700;
    letter-spacing: -0.2px;
    white-space: nowrap;
  }
  .when-text.past {
    color: var(--text-secondary);
  }
  .step {
    display: grid;
    place-items: center;
    padding: 0;
    width: 30px;
    height: 40px;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .step:disabled {
    opacity: 0.25;
    cursor: default;
  }
  .right {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 40px;
    justify-content: flex-end;
  }
</style>
