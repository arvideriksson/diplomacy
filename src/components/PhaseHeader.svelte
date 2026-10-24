<script lang="ts">
  // Top of the order sidebar: season + year (with ←/→ phase navigation in the sandbox),
  // the narrow-screen menu button for the left rail drawer, and the large phase banner,
  // color-coded by phase.
  import { isOrderPhase, PHASE_LABEL, type Phase } from '../lib/phases'

  export let phase: string
  export let season: string
  export let year: number
  /** Sandbox phase navigation (renders ←/→ around the label when provided). */
  export let onPhaseBack: (() => void) | null = null
  export let onPhaseForward: (() => void) | null = null
  export let canPhaseBack: boolean = false
  export let canPhaseForward: boolean = false
  /** Show the ☰ button that opens the left rail drawer (narrow screens only). */
  export let hasMenu: boolean = false
  export let menuOpen: boolean = false
  export let onToggleMenu: () => void = () => {}

  // Phase banner: human label + theme color key. The color keys map to tokens in
  // app.css that already define light/dark variants (--{key} / --{key}-subtle).
  const PHASE_TONE: Record<Phase, string> = { movement: 'accent', retreat: 'amber', build: 'green' }
  $: phaseMeta = isOrderPhase(phase)
    ? { label: PHASE_LABEL[phase], tone: PHASE_TONE[phase] }
    : { label: phase, tone: 'accent' }
</script>

<div class="side-head">
  {#if hasMenu}
    <button class="rail-toggle" on:click={onToggleMenu} title={menuOpen ? 'Close menu' : 'Menu'} aria-expanded={menuOpen}>☰</button>
  {/if}
  {#if onPhaseBack}
    <!-- Sandbox: step back/forward through the phase chain. -->
    <button class="nav" on:click={onPhaseBack} disabled={!canPhaseBack} title="Previous phase">←</button>
    <span class="phase-label">{season} {year}</span>
    <button class="nav" on:click={onPhaseForward} disabled={!canPhaseForward} title="Next phase">→</button>
  {:else}
    <span class="phase-label">{season} {year}</span>
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
  .rail-toggle {
    display: none;
    flex: none;
    width: 30px;
    height: 30px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    background: var(--bg-card, #fff);
    color: var(--text, #1a1a1a);
    font-size: 15px;
    cursor: pointer;
  }
  /* Tablets and phones: the left rail becomes a drawer, opened from here. */
  @media (max-width: 1100px) {
    .rail-toggle {
      display: inline-flex;
    }
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
