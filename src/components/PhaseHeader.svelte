<script lang="ts">
  // Top of the order sidebar: season + year (with ←/→ phase navigation in the sandbox),
  // a button that hides the sidebar, and the large phase banner, color-coded by phase.
  import { isOrderPhase, PHASE_LABEL, type Phase } from '../lib/phases'
  import Icon from './Icon.svelte'

  export let phase: string
  export let season: string
  export let year: number
  /** Sandbox phase navigation (renders ←/→ around the label when provided). */
  export let onPhaseBack: (() => void) | null = null
  export let onPhaseForward: (() => void) | null = null
  export let canPhaseBack: boolean = false
  export let canPhaseForward: boolean = false
  /** Hide the sidebar (a button at the header's right). */
  export let onHide: (() => void) | null = null

  // Phase banner: human label + theme color key. The color keys map to tokens in
  // app.css that already define light/dark variants (--{key} / --{key}-subtle).
  const PHASE_TONE: Record<Phase, string> = { movement: 'accent', retreat: 'amber', build: 'green' }
  $: phaseMeta = isOrderPhase(phase)
    ? { label: PHASE_LABEL[phase], tone: PHASE_TONE[phase] }
    : { label: phase, tone: 'accent' }
</script>

<div class="side-head">
  {#if onPhaseBack}
    <!-- Sandbox: step back/forward through the phase chain. -->
    <button class="nav" on:click={onPhaseBack} disabled={!canPhaseBack} title="Previous phase">←</button>
    <span class="phase-label">{season} {year}</span>
    <button class="nav" on:click={onPhaseForward} disabled={!canPhaseForward} title="Next phase">→</button>
  {:else}
    <span class="phase-label">{season} {year}</span>
  {/if}
  {#if onHide}
    <button class="hide" on:click={onHide} title="Hide sidebar" aria-label="Hide sidebar">
      <Icon name="panel-right" size={18} />
    </button>
  {/if}
</div>

<!-- Component-wide phase banner: large, color-coded by phase. -->
<div
  class="tone-banner"
  style="--tone: var(--{phaseMeta.tone}); --tone-subtle: var(--{phaseMeta.tone}-subtle);"
>
  {phaseMeta.label} Phase
</div>

<style>
  .side-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border, #eee);
  }
  /* Room for the hide button on the right, mirrored on the left so the season stays
     centred. */
  .side-head {
    position: relative;
  }
  .side-head:has(.hide) {
    padding-inline: 52px;
  }
  .hide {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .hide:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .side-head .nav {
    border: 1px solid var(--border-strong, #cbd5e1);
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
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
    text-align: center;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.2px;
  }
</style>
