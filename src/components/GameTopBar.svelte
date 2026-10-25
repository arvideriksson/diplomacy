<script lang="ts">
  // Phones: the one header shared by every tab — leave, the game's name over the
  // season/phase (with ‹ › history steps), the countdown, and slotted actions. A sandbox
  // tints it and names itself so it can never be mistaken for the real game.
  import { onDestroy } from 'svelte'
  import Icon from './Icon.svelte'
  import { isOrderPhase, PHASE_LABEL } from '../lib/phases'
  import { formatCountdown } from '../lib/time'

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

  let now = Date.now()
  const clock = setInterval(() => (now = Date.now()), 1000)
  onDestroy(() => clearInterval(clock))

  $: phaseLabel = isOrderPhase(phase) ? PHASE_LABEL[phase] : phase
  $: msLeft = deadline ? new Date(deadline).getTime() - now : null
  $: graceLeft = graceEndsAt ? new Date(graceEndsAt).getTime() - now : null
  $: inGrace = msLeft != null && msLeft <= 0 && graceLeft != null && graceLeft > 0
  $: countdown = msLeft == null ? '' : formatCountdown(inGrace ? graceLeft! : msLeft).replace(/ left$/, '')
  $: urgent = msLeft != null && (inGrace || msLeft <= 60 * 60 * 1000)
</script>

<header class="top" class:sandbox>
  {#if onExit}
    <button class="icon-btn exit" on:click={onExit} aria-label={exitLabel || 'Leave game'}>
      <Icon name={exitLabel ? 'back' : 'exit'} size={20} strokeWidth={2.4} round />
      {#if exitLabel}<span class="exit-label">{exitLabel}</span>{/if}
    </button>
  {/if}
  <div class="mid">
    <span class="title">
      {#if sandbox}<span class="sb-tag">Sandbox</span>{/if}
      {title}
    </span>
    <span class="when">
      {#if onPhaseBack}
        <button class="step" on:click={onPhaseBack} disabled={!canPhaseBack} aria-label="Previous phase">‹</button>
      {/if}
      <span class="when-text" class:past>{phase === 'build' ? 'Winter' : season} {year} · {phaseLabel}</span>
      {#if onPhaseForward}
        <button class="step" on:click={onPhaseForward} disabled={!canPhaseForward} aria-label="Next phase">›</button>
      {/if}
    </span>
  </div>
  <div class="right">
    {#if countdown}
      <span class="clock" class:urgent class:grace={inGrace} title={inGrace ? 'Grace period' : 'Time left'}>{countdown}</span>
    {/if}
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
    width: 30px;
    height: 40px;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--text);
    font-size: 22px;
    line-height: 1;
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
  .clock {
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    padding: 4px 6px;
    font-size: 11.5px;
    border-radius: 999px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    white-space: nowrap;
  }
  .clock.urgent {
    color: var(--red);
  }
  .clock.grace {
    color: var(--amber);
    border-color: var(--amber);
  }
</style>
