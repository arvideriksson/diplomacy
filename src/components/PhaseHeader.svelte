<script lang="ts">
  // Top of the order sidebar: season + year with a phase pill color-coded by phase
  // (and ←/→ phase navigation).
  import { isOrderPhase, PHASE_LABEL, roundSeason, type Phase } from '../lib/phases'

  export let phase: string
  export let season: string
  export let year: number
  /** Sandbox phase navigation (renders ←/→ around the label when provided). */
  export let onPhaseBack: (() => void) | null = null
  export let onPhaseForward: (() => void) | null = null
  export let canPhaseBack: boolean = false
  export let canPhaseForward: boolean = false

  // Phase banner: human label + theme color key. The color keys map to tokens in
  // app.css that already define light/dark variants (--{key} / --{key}-subtle).
  const PHASE_TONE: Record<Phase, string> = { movement: 'accent', retreat: 'amber', build: 'green' }
  $: phaseMeta = isOrderPhase(phase)
    ? { label: PHASE_LABEL[phase], tone: PHASE_TONE[phase] }
    : { label: phase, tone: 'accent' }
  $: shownSeason = roundSeason({ season, phase })
  $: toneStyle = `--tone: var(--${phaseMeta.tone}); --tone-subtle: var(--${phaseMeta.tone}-subtle);`
</script>

<div class="side-head">
  <!-- Balances the slotted control on the right (e.g. hide), so the label stays centred. -->
  {#if $$slots.default}<span class="balance" aria-hidden="true"></span>{/if}
  <span class="phase-label">
    {#if onPhaseBack}
      <!-- Sandbox: step back/forward through the phase chain, either side of the label. -->
      <button class="nav" on:click={onPhaseBack} disabled={!canPhaseBack} title="Previous phase" aria-label="Previous phase">←</button>
    {/if}
    {shownSeason} {year}<span class="pill" style={toneStyle}>{phaseMeta.label}</span>
    {#if onPhaseForward}
      <button class="nav" on:click={onPhaseForward} disabled={!canPhaseForward} title="Next phase" aria-label="Next phase">→</button>
    {/if}
  </span>
  <slot />
</div>

<style>
  .balance {
    flex: none;
    width: 32px;
  }
  .side-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .side-head .nav {
    border: 1px solid var(--border-strong);
    background: var(--bg-input);
    color: var(--text);
    border-radius: 6px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    flex: none;
  }
  .side-head .nav:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .side-head .phase-label {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    white-space: nowrap;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.2px;
  }
  .pill {
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--tone-subtle);
    color: var(--tone);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
</style>
