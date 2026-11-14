<script lang="ts">
  // Top of the order sidebar: season + year in the display serif over the phase in
  // phase-coloured caps, with ‹ › phase navigation in fixed columns either side.
  import Icon from './Icon.svelte'
  import { isOrderPhase, PHASE_LABEL, roundSeason, type Phase } from '../lib/phases'

  export let phase: string
  export let season: string
  export let year: number
  /** Phase navigation (renders ‹ › around the label when provided). */
  export let onPhaseBack: (() => void) | null = null
  export let onPhaseForward: (() => void) | null = null
  export let canPhaseBack: boolean = false
  export let canPhaseForward: boolean = false

  // The color keys map to tokens in app.css that define light/dark variants.
  const PHASE_TONE: Record<Phase, string> = { movement: 'accent', retreat: 'amber', build: 'green' }
  $: phaseMeta = isOrderPhase(phase)
    ? { label: PHASE_LABEL[phase], tone: PHASE_TONE[phase] }
    : { label: phase, tone: 'accent' }
  $: shownSeason = roundSeason({ season, phase })
</script>

<div class="side-head">
  <!-- Balances the slotted control on the right (e.g. hide), so the label stays centred. -->
  {#if $$slots.default}<span class="balance" aria-hidden="true"></span>{/if}
  <!-- The arrows sit in fixed columns, so a label of a different length never moves them. -->
  <span class="phase-label">
    {#if onPhaseBack}
      <button class="nav" on:click={onPhaseBack} disabled={!canPhaseBack} title="Previous phase" aria-label="Previous phase">
        <Icon name="back" size={16} strokeWidth={2.4} round />
      </button>
    {:else}<span></span>{/if}
    <span class="stack">
      <span class="when">{shownSeason} {year}</span>
      <span class="phase" style="--tone: var(--{phaseMeta.tone})">{phaseMeta.label}</span>
    </span>
    {#if onPhaseForward}
      <button class="nav" on:click={onPhaseForward} disabled={!canPhaseForward} title="Next phase" aria-label="Next phase">
        <Icon name="chevron-right" size={16} strokeWidth={2.4} round />
      </button>
    {:else}<span></span>{/if}
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
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .phase-label {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) 30px;
    align-items: center;
  }
  .nav {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s;
  }
  .nav:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
  .nav:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .stack {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    line-height: 1.15;
    white-space: nowrap;
  }
  .when {
    font: 700 17px var(--font-display);
    letter-spacing: -0.2px;
  }
  .phase {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--tone);
  }
  @media (prefers-reduced-motion: reduce) {
    .nav {
      transition: none;
    }
  }
</style>
