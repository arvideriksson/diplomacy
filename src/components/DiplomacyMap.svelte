<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import type { Unit } from '../lib/game'
  import type { MapDefinition, PowerDefinition } from '../lib/mapDefinition'

  export let mapDef: MapDefinition
  export let units: Unit[] = []
  export let selectedTerritory: string | null = null
  export let ownership: Record<string, string> = {}

  $: powerMap = Object.fromEntries(mapDef.powers.map((p) => [p.id, p]))

  function getPower(id: string): PowerDefinition | undefined {
    return powerMap[id]
  }

  function getUnitAt(territory: string): Unit | undefined {
    return units.find((u) => u.territory === territory)
  }

  function getOwnerColor(territoryId: string): string | undefined {
    const owner = ownership[territoryId]
    if (!owner) return undefined
    return getPower(owner)?.color
  }

  function territoryFill(id: string): string {
    const t = mapDef.territories[id]
    if (t.type === 'sea') return 'transparent'
    const ownerColor = getOwnerColor(id)
    if (ownerColor) return ownerColor + '30'
    const unit = getUnitAt(id)
    if (unit) {
      const p = getPower(unit.nation)
      return p ? p.color + '20' : '#f8faf8'
    }
    return '#f0f0ee'
  }

  function territoryStroke(id: string): string {
    if (selectedTerritory === id) return '#f59e0b'
    const t = mapDef.territories[id]
    if (t.type === 'sea') return 'none'
    const ownerColor = getOwnerColor(id)
    if (ownerColor) return ownerColor + '50'
    return '#bbb'
  }

  function handleTerritoryClick(id: string) {
    selectedTerritory = selectedTerritory === id ? null : id
  }

  function unitColor(unit: Unit): string {
    return getPower(unit.nation)?.color ?? '#888'
  }
</script>

<div class="map-container">
  <svg viewBox={mapDef.viewBox} xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <pattern id="water" width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="#dbeafe" />
        <path d="M0 12 Q6 9 12 12 Q18 15 24 12" stroke="#bfdbfe" stroke-width="0.5" fill="none" opacity="0.6" />
      </pattern>
      <filter id="unit-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.15" />
      </filter>
    </defs>

    <!-- Water background -->
    <rect width="100%" height="100%" fill="url(#water)" rx="8" />

    <!-- Land territories -->
    {#each Object.entries(mapDef.territories) as [id, t] (id)}
      {#if t.render.path && t.type !== 'sea'}
        <path
          d={t.render.path}
          fill={territoryFill(id)}
          stroke={territoryStroke(id)}
          stroke-width={selectedTerritory === id ? 2 : 0.8}
          class="territory-path"
          on:click={() => handleTerritoryClick(id)}
          on:keydown={(e) => e.key === 'Enter' && handleTerritoryClick(id)}
          role="button"
          tabindex="0"
        />
      {/if}
    {/each}

    <!-- Supply center markers -->
    {#each Object.entries(mapDef.territories) as [id, t] (id)}
      {#if t.supplyCenter}
        {@const [cx, cy] = t.render.center}
        <circle
          cx={cx}
          cy={cy + 10}
          r="3"
          fill="none"
          stroke={t.homePower ? (getPower(t.homePower)?.color ?? '#444') : '#444'}
          stroke-width="1.2"
          class="supply-center"
        />
      {/if}
    {/each}

    <!-- Territory labels -->
    {#each Object.entries(mapDef.territories) as [id, t] (id)}
      {@const [cx, cy] = t.render.center}
      {@const unit = getUnitAt(id)}
      <text
        x={cx + (t.render.labelOffset?.[0] ?? 0)}
        y={cy - (unit ? 10 : 2) + (t.render.labelOffset?.[1] ?? 0)}
        text-anchor="middle"
        dominant-baseline="central"
        class="territory-label"
        class:sea={t.type === 'sea'}
        on:click={() => handleTerritoryClick(id)}
        on:keydown={(e) => e.key === 'Enter' && handleTerritoryClick(id)}
        role="button"
        tabindex="-1"
      >
        {id}
      </text>
    {/each}

    <!-- Units -->
    {#each units as unit (unit.territory)}
      {@const t = mapDef.territories[unit.territory]}
      {#if t}
        {@const [cx, cy] = t.render.center}
        <g transition:scale={{ duration: 300, easing: cubicOut }}>
          {#if unit.type === 'army'}
            <rect
              x={cx - 8}
              y={cy - 8}
              width="16"
              height="16"
              rx="3"
              fill={unitColor(unit)}
              stroke="white"
              stroke-width="1.2"
              filter="url(#unit-shadow)"
            />
            <text x={cx} y={cy} text-anchor="middle" dominant-baseline="central" class="unit-label">A</text>
          {:else}
            <polygon
              points="{cx},{cy - 10} {cx + 10},{cy + 6} {cx - 10},{cy + 6}"
              fill={unitColor(unit)}
              stroke="white"
              stroke-width="1.2"
              filter="url(#unit-shadow)"
            />
            <text x={cx} y={cy} text-anchor="middle" dominant-baseline="central" class="unit-label">F</text>
          {/if}
        </g>
      {/if}
    {/each}

    <!-- Sea zone click targets (invisible) -->
    {#each Object.entries(mapDef.territories) as [id, t] (id)}
      {#if t.type === 'sea'}
        {@const [cx, cy] = t.render.center}
        <circle
          {cx}
          {cy}
          r="20"
          fill="transparent"
          class="sea-target"
          on:click={() => handleTerritoryClick(id)}
          on:keydown={(e) => e.key === 'Enter' && handleTerritoryClick(id)}
          role="button"
          tabindex="0"
        />
      {/if}
    {/each}
  </svg>

  {#if selectedTerritory}
    {@const terr = mapDef.territories[selectedTerritory]}
    {@const unit = getUnitAt(selectedTerritory)}
    <div class="territory-info" transition:fade={{ duration: 150 }}>
      <h3>{terr.name}</h3>
      <div class="info-badges">
        <span class="territory-type-badge" class:sea={terr.type === 'sea'} class:coast={terr.type === 'coast'}>
          {terr.type}
        </span>
        {#if terr.supplyCenter}
          <span class="sc-badge">SC</span>
        {/if}
      </div>
      {#if unit}
        {@const power = getPower(unit.nation)}
        <div class="unit-info">
          <span class="nation-dot" style="background: {power?.color ?? '#888'}"></span>
          <span class="nation-name">{power?.name ?? unit.nation}</span>
          <span class="unit-type">{unit.type}</span>
        </div>
      {/if}
      {#if terr.adjacent.length}
        <div class="adjacent-info">
          <span class="adj-label">Adjacent:</span>
          <span class="adj-list">{terr.adjacent.join(', ')}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .map-container {
    position: relative;
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
  }

  svg {
    width: 100%;
    height: auto;
    border-radius: var(--radius-lg, 14px);
    box-shadow: var(--shadow-lg, 0 8px 30px rgba(0, 0, 0, 0.08));
  }

  .territory-path {
    cursor: pointer;
    outline: none;
    transition: fill 0.15s, stroke 0.15s, stroke-width 0.1s;
  }

  .territory-path:hover {
    filter: brightness(0.95);
    stroke-width: 2;
  }

  .territory-path:focus-visible {
    stroke: #f59e0b;
    stroke-width: 2.5;
  }

  .territory-label {
    font-size: 7px;
    font-weight: 600;
    fill: #4b5563;
    pointer-events: none;
    user-select: none;
    letter-spacing: 0.3px;
    font-family: var(--font, system-ui);
    cursor: pointer;
    pointer-events: auto;
  }

  .territory-label.sea {
    fill: #3b82f6;
    font-weight: 500;
    font-size: 6px;
    opacity: 0.7;
  }

  .supply-center {
    pointer-events: none;
  }

  .unit-label {
    font-size: 8px;
    font-weight: 700;
    fill: white;
    pointer-events: none;
    font-family: var(--font, system-ui);
  }

  .sea-target {
    cursor: pointer;
    outline: none;
  }

  .territory-info {
    position: absolute;
    bottom: 16px;
    left: 16px;
    background: var(--bg-card, white);
    border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
    border-radius: var(--radius-md, 10px);
    padding: 12px 16px;
    box-shadow: var(--shadow-lg, 0 8px 30px rgba(0, 0, 0, 0.08));
    min-width: 160px;
    max-width: 260px;
  }

  .territory-info h3 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text, #1a1a1a);
  }

  .info-badges {
    display: flex;
    gap: 5px;
    margin-bottom: 4px;
  }

  .territory-type-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 7px;
    border-radius: var(--radius-full, 9999px);
    background: var(--green-subtle, rgba(5, 150, 105, 0.1));
    color: var(--green, #059669);
  }

  .territory-type-badge.sea {
    background: var(--accent-subtle, rgba(37, 99, 235, 0.08));
    color: var(--accent, #2563eb);
  }

  .territory-type-badge.coast {
    background: rgba(14, 165, 233, 0.1);
    color: #0ea5e9;
  }

  .sc-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: var(--radius-full, 9999px);
    background: rgba(234, 179, 8, 0.12);
    color: #ca8a04;
    letter-spacing: 0.5px;
  }

  .unit-info {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: 13px;
  }

  .nation-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .nation-name {
    font-weight: 600;
    color: var(--text, #1a1a1a);
  }

  .unit-type {
    color: var(--text-tertiary, #8c8c8c);
    text-transform: capitalize;
  }

  .adjacent-info {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-secondary, #666);
    line-height: 1.4;
  }

  .adj-label {
    font-weight: 600;
    margin-right: 3px;
  }

  .adj-list {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    letter-spacing: 0.2px;
  }
</style>
