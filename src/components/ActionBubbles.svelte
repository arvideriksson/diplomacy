<script lang="ts">
  // Radial action menu drawn over the map: an arc of round buttons around a unit (or a
  // supply center in builds). Positioned in wrapper pixels by DiplomacyMap so it tracks
  // pan/zoom without scaling. Pointer events stop here so a tap never pans the map or
  // reaches the province beneath.
  import { scale } from 'svelte/transition'
  import { backOut } from 'svelte/easing'
  import type { Bubble } from '../lib/orders/bubbles'
  import { unitTokenSvg, DEFAULT_UNIT_STYLE } from '../lib/map/unitStyles'

  export let items: Bubble[]
  /** The anchor (unit centre) in wrapper px, and the wrapper size for edge clamping. */
  export let x: number
  export let y: number
  export let width: number
  export let height: number
  export let onPick: (id: string) => void

  const SIZE = 56
  const MARGIN = 8

  // Arc angles (degrees, 0 = right, -90 = up) by item count: the menu fans out ABOVE the
  // unit so the tapping thumb doesn't cover it; flipped below near the top edge.
  const ARCS: Record<number, number[]> = {
    1: [-90],
    2: [-140, -40],
    3: [-160, -90, -20],
    4: [-180, -120, -60, 0],
    5: [-180, -135, -90, -45, 0],
  }
  $: radius = items.length <= 2 ? 58 : 66
  $: flip = y - radius - SIZE / 2 < MARGIN
  $: angles = (ARCS[items.length] ?? ARCS[5]).map((a) => (flip ? -a : a))
  // Keep the whole arc inside the map: shift the centre inward near the edges.
  $: reach = radius + SIZE / 2 + MARGIN
  $: cx = Math.min(Math.max(x, items.length > 1 ? reach : x), width - reach)
  $: cy = flip ? Math.min(y, height - reach) : Math.max(y, reach)
  $: placed = items.map((b, i) => {
    const a = (angles[i] * Math.PI) / 180
    return { b, left: cx + radius * Math.cos(a), top: cy + radius * Math.sin(a) }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="bubbles" on:pointerdown|stopPropagation on:click|stopPropagation>
  <span class="ring" style="left:{x}px; top:{y}px"></span>
  {#each placed as { b, left, top }, i (b.id)}
    <button
      class="bubble"
      class:active={b.active}
      class:danger={b.tone === 'danger'}
      disabled={b.disabled}
      style="left:{left}px; top:{top}px"
      in:scale={{ duration: 180, delay: i * 30, start: 0.4, easing: backOut }}
      on:click={() => onPick(b.id)}
      aria-label={b.label}
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
  .bubbles {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 18;
  }
  /* Marks the unit the menu belongs to. */
  .ring {
    position: absolute;
    width: 34px;
    height: 34px;
    margin: -17px 0 0 -17px;
    border-radius: 50%;
    border: 2.5px solid #fff;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35), 0 0 14px rgba(255, 255, 255, 0.7);
    animation: ring-pulse 1.6s ease-in-out infinite;
  }
  @keyframes ring-pulse {
    50% {
      transform: scale(1.18);
      opacity: 0.7;
    }
  }
  .bubble {
    position: absolute;
    width: 56px;
    height: 56px;
    margin: -28px 0 0 -28px;
    pointer-events: auto;
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
    cursor: pointer;
    font-family: var(--font);
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.1s ease, background 0.1s ease;
  }
  @media (hover: hover) {
    .bubble:hover:not(:disabled) {
      background: color-mix(in srgb, var(--accent) 16%, var(--bg-elevated));
      border-color: var(--accent);
    }
  }
  .bubble:active {
    transform: scale(0.92);
  }
  .bubble.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .bubble.danger {
    color: var(--red);
  }
  .bubble:disabled {
    cursor: default;
    color: var(--text-tertiary);
    background: color-mix(in srgb, var(--bg-elevated) 70%, transparent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }
  .bubble:disabled:hover {
    border-color: color-mix(in srgb, var(--border-strong) 80%, transparent);
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
    letter-spacing: 0.1px;
    line-height: 1.1;
    max-width: 52px;
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
