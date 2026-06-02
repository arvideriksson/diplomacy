<script lang="ts">
  import { unitStyle } from '../lib/unitStyle'
  import { standardMap } from '../lib/maps/standard'
  import {
    ARMY_DEFS,
    FLEET_DEFS,
    previewSvg,
    DEFAULT_UNIT_STYLE,
    type ArmyStyleId,
    type FleetStyleId,
  } from '../lib/map/unitStyles'

  let open = true

  // A few representative powers (blue / red / yellow) for the preview swatches.
  const sampleColors = ['england', 'austria', 'turkey']
    .map((id) => standardMap.powers.find((p) => p.id === id)?.color)
    .filter((c): c is string => Boolean(c))

  const armyDef = (id: ArmyStyleId) => ARMY_DEFS.find((d) => d.id === id) ?? ARMY_DEFS[0]
  const fleetDef = (id: FleetStyleId) => FLEET_DEFS.find((d) => d.id === id) ?? FLEET_DEFS[0]

  $: armyPreview = sampleColors.map((c) => previewSvg(armyDef($unitStyle.army), c, $unitStyle, 34)).join('')
  $: fleetPreview = sampleColors.map((c) => previewSvg(fleetDef($unitStyle.fleet), c, $unitStyle, 34)).join('')
</script>

<div class="picker" class:collapsed={!open}>
  <button class="head" on:click={() => (open = !open)}>
    <span>Unit style</span><span class="chev">{open ? '▾' : '▸'}</span>
  </button>

  {#if open}
    <div class="body">
      <label class="field">
        <span>Army</span>
        <select bind:value={$unitStyle.army}>
          {#each ARMY_DEFS as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Fleet</span>
        <select bind:value={$unitStyle.fleet}>
          {#each FLEET_DEFS as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
        </select>
      </label>

      <div class="field">
        <span>Glyph</span>
        <div class="seg">
          <button class:on={$unitStyle.glyphFill === '#fff'} on:click={() => ($unitStyle.glyphFill = '#fff')}>White</button>
          <button class:on={$unitStyle.glyphFill === '#111'} on:click={() => ($unitStyle.glyphFill = '#111')}>Black</button>
        </div>
      </div>
      <div class="field">
        <span>Ring</span>
        <div class="seg">
          <button class:on={$unitStyle.ring === '#1a1a1a'} on:click={() => ($unitStyle.ring = '#1a1a1a')}>Dark</button>
          <button class:on={$unitStyle.ring === '#ffffff'} on:click={() => ($unitStyle.ring = '#ffffff')}>White</button>
          <button class:on={$unitStyle.ring === 'none'} on:click={() => ($unitStyle.ring = 'none')}>None</button>
        </div>
      </div>

      <div class="preview">
        <div><div class="plabel">Army</div><div class="swatches">{@html armyPreview}</div></div>
        <div><div class="plabel">Fleet</div><div class="swatches">{@html fleetPreview}</div></div>
      </div>

      <button class="reset" on:click={() => unitStyle.set({ ...DEFAULT_UNIT_STYLE })}>Reset to default</button>
    </div>
  {/if}
</div>

<style>
  .picker {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 20;
    width: 248px;
    background: color-mix(in srgb, var(--bg-card, #fff) 92%, transparent);
    backdrop-filter: blur(10px) saturate(1.4);
    -webkit-backdrop-filter: blur(10px) saturate(1.4);
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 10px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
    color: var(--text, #1a1a1a);
    font-size: 12px;
    overflow: hidden;
  }
  .picker.collapsed {
    width: auto;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 8px 11px;
    border: 0;
    background: transparent;
    color: inherit;
    font: 600 12px ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  .chev {
    opacity: 0.6;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 4px 11px 11px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field > span {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary, #777);
  }
  select {
    padding: 5px 6px;
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 7px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    font: inherit;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 7px;
    overflow: hidden;
  }
  .seg button {
    flex: 1;
    border: 0;
    border-right: 1px solid var(--border-strong, #cbd5e1);
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    padding: 5px 0;
    font: inherit;
    cursor: pointer;
  }
  .seg button:last-child {
    border-right: 0;
  }
  .seg button.on {
    background: #2f6f4f;
    color: #fff;
  }
  .preview {
    display: flex;
    gap: 16px;
    padding: 6px 0 2px;
  }
  .plabel {
    font-size: 10px;
    color: var(--text-secondary, #777);
    margin-bottom: 3px;
  }
  .swatches {
    display: flex;
    gap: 5px;
    padding: 4px;
    border-radius: 7px;
    background: #aecadf;
  }
  .reset {
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 7px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    padding: 5px 0;
    font: inherit;
    cursor: pointer;
  }
</style>
