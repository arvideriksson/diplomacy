<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import type { Unit } from '../lib/game'

  export let units: Unit[] = []
  export let selectedTerritory: string | null = null

  const NATIONS: Record<string, string> = {
    England: '#1e40af',
    France: '#3b82f6',
    Germany: '#6b7280',
    Italy: '#16a34a',
    Austria: '#dc2626',
    Russia: '#7c3aed',
    Turkey: '#f59e0b',
  }

  const TERRITORIES: Record<string, { x: number; y: number; name: string; type: 'land' | 'sea' }> = {
    LON: { x: 210, y: 225, name: 'London', type: 'land' },
    PAR: { x: 215, y: 310, name: 'Paris', type: 'land' },
    BER: { x: 330, y: 230, name: 'Berlin', type: 'land' },
    ROM: { x: 310, y: 420, name: 'Rome', type: 'land' },
    VIE: { x: 370, y: 310, name: 'Vienna', type: 'land' },
    MOS: { x: 530, y: 180, name: 'Moscow', type: 'land' },
    CON: { x: 470, y: 430, name: 'Constantinople', type: 'land' },
    MUN: { x: 310, y: 280, name: 'Munich', type: 'land' },
    MAR: { x: 240, y: 370, name: 'Marseilles', type: 'land' },
    BUD: { x: 400, y: 330, name: 'Budapest', type: 'land' },
    WAR: { x: 420, y: 230, name: 'Warsaw', type: 'land' },
    ANK: { x: 530, y: 430, name: 'Ankara', type: 'land' },
    NTH: { x: 240, y: 150, name: 'North Sea', type: 'sea' },
    ENG: { x: 180, y: 270, name: 'English Channel', type: 'sea' },
    MED: { x: 310, y: 480, name: 'Mediterranean', type: 'sea' },
    BLA: { x: 500, y: 380, name: 'Black Sea', type: 'sea' },
  }

  function getUnitAt(territory: string): Unit | undefined {
    return units.find((u) => u.territory === territory)
  }

  function handleTerritoryClick(id: string) {
    selectedTerritory = selectedTerritory === id ? null : id
  }
</script>

<div class="map-container">
  <svg viewBox="0 0 700 560" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <pattern id="water" width="20" height="20" patternUnits="userSpaceOnUse">
        <rect width="20" height="20" fill="#dbeafe" />
        <path d="M0 10 Q5 7 10 10 Q15 13 20 10" stroke="#bfdbfe" stroke-width="0.6" fill="none" opacity="0.7" />
      </pattern>
      <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.1" />
      </filter>
    </defs>

    <rect width="700" height="560" fill="url(#water)" rx="12" />

    {#each Object.entries(TERRITORIES) as [id, t] (id)}
      {@const unit = getUnitAt(id)}
      {@const isSelected = selectedTerritory === id}
      <g
        class="territory"
        on:click={() => handleTerritoryClick(id)}
        on:keydown={(e) => e.key === 'Enter' && handleTerritoryClick(id)}
        role="button"
        tabindex="0"
      >
        {#if t.type === 'land'}
          <circle
            cx={t.x}
            cy={t.y}
            r="28"
            fill={unit ? NATIONS[unit.nation] + '20' : '#f8faf8'}
            stroke={isSelected ? '#f59e0b' : unit ? NATIONS[unit.nation] + '60' : '#c8d0d8'}
            stroke-width={isSelected ? 2.5 : 1}
            class="territory-bg"
          />
        {:else}
          <circle
            cx={t.x}
            cy={t.y}
            r="24"
            fill="rgba(255,255,255,0.15)"
            stroke={isSelected ? '#f59e0b' : '#93c5fd'}
            stroke-width={isSelected ? 2.5 : 1}
            stroke-dasharray="4 3"
            class="territory-bg"
          />
        {/if}

        <text
          x={t.x}
          y={t.y - (unit ? 18 : 0)}
          text-anchor="middle"
          dominant-baseline="central"
          class="territory-label"
          class:sea={t.type === 'sea'}
        >
          {id}
        </text>

        {#if unit}
          <g transition:scale={{ duration: 350, easing: cubicOut }}>
            {#if unit.type === 'army'}
              <rect
                x={t.x - 10}
                y={t.y - 10}
                width="20"
                height="20"
                rx="4"
                fill={NATIONS[unit.nation]}
                stroke="white"
                stroke-width="1.5"
                filter="url(#card-shadow)"
              />
              <text x={t.x} y={t.y} text-anchor="middle" dominant-baseline="central" class="unit-label">A</text>
            {:else}
              <polygon
                points="{t.x},{t.y - 12} {t.x + 12},{t.y + 8} {t.x - 12},{t.y + 8}"
                fill={NATIONS[unit.nation]}
                stroke="white"
                stroke-width="1.5"
                filter="url(#card-shadow)"
              />
              <text x={t.x} y={t.y + 1} text-anchor="middle" dominant-baseline="central" class="unit-label">F</text>
            {/if}
          </g>
        {/if}
      </g>
    {/each}
  </svg>

  {#if selectedTerritory}
    {@const terr = TERRITORIES[selectedTerritory]}
    {@const unit = getUnitAt(selectedTerritory)}
    <div class="territory-info" transition:fade={{ duration: 150 }}>
      <h3>{terr.name}</h3>
      <span class="territory-type-badge" class:sea={terr.type === 'sea'}>
        {terr.type === 'sea' ? 'Sea' : 'Land'}
      </span>
      {#if unit}
        <div class="unit-info">
          <span class="nation-dot" style="background: {NATIONS[unit.nation]}"></span>
          <span class="nation-name">{unit.nation}</span>
          <span class="unit-type">{unit.type}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .map-container {
    position: relative;
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
  }

  svg {
    width: 100%;
    height: auto;
    border-radius: var(--radius-lg, 14px);
    box-shadow: var(--shadow-lg, 0 8px 30px rgba(0, 0, 0, 0.08));
  }

  .territory {
    cursor: pointer;
    outline: none;
  }

  .territory-bg {
    transition: stroke 0.2s, stroke-width 0.15s, fill 0.2s;
  }

  .territory:hover .territory-bg {
    fill-opacity: 0.9;
    stroke-width: 2;
  }

  .territory:focus-visible .territory-bg {
    stroke: #f59e0b;
    stroke-width: 2.5;
  }

  .territory-label {
    font-size: 10px;
    font-weight: 600;
    fill: #4b5563;
    pointer-events: none;
    user-select: none;
    letter-spacing: 0.5px;
    font-family: var(--font, system-ui);
  }

  .territory-label.sea {
    fill: #3b82f6;
    font-weight: 500;
    font-size: 9px;
  }

  .unit-label {
    font-size: 10px;
    font-weight: 700;
    fill: white;
    pointer-events: none;
    font-family: var(--font, system-ui);
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
    min-width: 140px;
  }

  .territory-info h3 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text, #1a1a1a);
  }

  .territory-type-badge {
    display: inline-block;
    font-size: 11px;
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
</style>
