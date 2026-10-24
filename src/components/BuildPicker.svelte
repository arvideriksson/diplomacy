<script lang="ts">
  // Build-phase unit-type picker: a rounded card tray anchored at the clicked supply
  // center, one card per buildable unit (an army, and a fleet per coast on multi-coast
  // provinces). Clicks inside it don't reach the map area (which would dismiss it).
  import type { MapDefinition } from '../lib/mapDefinition'
  import type { BuildSpot } from '../lib/orders/adjustments'
  import { coastName } from '../lib/orders/board'
  import { powerColor } from '../lib/powers'
  import { unitTokenSvg, DEFAULT_UNIT_STYLE } from '../lib/map/unitStyles'

  export let mapDef: MapDefinition
  /** The center being built on and the nation building there. */
  export let province: string
  export let nation: string
  /** What may be built at `province`. */
  export let spot: BuildSpot
  /** Anchor point (px) within the map area. */
  export let x: number
  export let y: number
  export let onPick: (unitType: 'army' | 'fleet', coast?: string) => void

  type Option = { unitType: 'army' | 'fleet'; token: 'Army' | 'Fleet'; label: string; coast?: string }

  $: color = powerColor(mapDef.powers, nation, '#888')
  $: options = ((): Option[] => {
    const out: Option[] = []
    if (spot.types.includes('army')) out.push({ unitType: 'army', token: 'Army', label: 'Army' })
    if (spot.types.includes('fleet')) {
      if (spot.coasts && spot.coasts.length > 1) {
        for (const c of spot.coasts)
          out.push({ unitType: 'fleet', token: 'Fleet', label: `Fleet (${coastName(mapDef, province, c)})`, coast: c })
      } else {
        out.push({ unitType: 'fleet', token: 'Fleet', label: 'Fleet' })
      }
    }
    return out
  })()
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
<div
  class="glass build-popup"
  style="left:{x}px; top:{y}px"
  role="group"
  aria-label="Choose unit to build"
  on:click|stopPropagation
  on:pointerdown|stopPropagation
>
  {#each options as opt}
    <button class="build-card" on:click={() => onPick(opt.unitType, opt.coast)}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <svg class="bc-token" viewBox="0 0 32 32" aria-hidden="true">{@html unitTokenSvg(16, 16, opt.token, color, 13, DEFAULT_UNIT_STYLE)}</svg>
      <span class="bc-label">{opt.label}</span>
    </button>
  {/each}
</div>

<style>
  /* A rounded card tray anchored at the clicked centre. */
  .build-popup {
    position: absolute;
    transform: translate(-50%, calc(-100% - 14px));
    display: flex;
    gap: 8px;
    padding: 8px;
    border-radius: 14px;
    /* .glass, with a slightly deeper shadow so the tray lifts off the map. */
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
    z-index: 20;
  }
  /* little pointer at the bottom, aimed at the clicked centre */
  .build-popup::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -7px;
    width: 14px;
    height: 14px;
    transform: translateX(-50%) rotate(45deg);
    background: inherit;
    border-right: 1px solid var(--border, rgba(0, 0, 0, 0.12));
    border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  }
  .build-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 72px;
    padding: 10px 8px;
    border: 1px solid color-mix(in srgb, var(--border-strong, #cbd5e1) 70%, transparent);
    border-radius: 10px;
    /* Translucent so the tray's frosted blur reads through, matching the SC card. */
    background: color-mix(in srgb, var(--bg-input, #fff) 35%, transparent);
    color: var(--text, #1a1a1a);
    cursor: pointer;
    transition: transform 0.08s ease, border-color 0.08s ease, background 0.08s ease;
  }
  .build-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent, #6366f1);
    background: color-mix(in srgb, var(--accent, #6366f1) 18%, transparent);
  }
  .bc-token {
    width: 40px;
    height: 40px;
  }
  .bc-label {
    font-size: 12px;
    font-weight: 600;
  }
</style>
