<script lang="ts">
  import { tweened } from 'svelte/motion'
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { flip } from 'svelte/animate'
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
        <rect width="20" height="20" fill="#bfdbfe" />
        <path d="M0 10 Q5 8 10 10 Q15 12 20 10" stroke="#93c5fd" stroke-width="0.5" fill="none" />
      </pattern>
    </defs>

    <rect width="700" height="560" fill="url(#water)" rx="8" />

    {#each Object.entries(TERRITORIES) as [id, t] (id)}
      <g
        class="territory"
        class:selected={selectedTerritory === id}
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
            fill={getUnitAt(id) ? NATIONS[getUnitAt(id)!.nation] + '33' : '#f0fdf4'}
            stroke={selectedTerritory === id ? '#f59e0b' : '#94a3b8'}
            stroke-width={selectedTerritory === id ? 2.5 : 1}
          />
        {:else}
          <circle
            cx={t.x}
            cy={t.y}
            r="24"
            fill="none"
            stroke={selectedTerritory === id ? '#f59e0b' : '#60a5fa'}
            stroke-width={selectedTerritory === id ? 2.5 : 1}
            stroke-dasharray="4 3"
          />
        {/if}

        <text
          x={t.x}
          y={t.y - (getUnitAt(id) ? 18 : 0)}
          text-anchor="middle"
          dominant-baseline="central"
          class="territory-label"
          class:sea={t.type === 'sea'}
        >
          {id}
        </text>

        {#if getUnitAt(id)}
          {@const unit = getUnitAt(id)!}
          <g transition:scale={{ duration: 400, easing: cubicOut }}>
            {#if unit.type === 'army'}
              <rect
                x={t.x - 10}
                y={t.y - 10}
                width="20"
                height="20"
                rx="3"
                fill={NATIONS[unit.nation]}
                stroke="white"
                stroke-width="1.5"
              />
              <text x={t.x} y={t.y} text-anchor="middle" dominant-baseline="central" class="unit-label">A</text>
            {:else}
              <polygon
                points="{t.x},{t.y - 12} {t.x + 12},{t.y + 8} {t.x - 12},{t.y + 8}"
                fill={NATIONS[unit.nation]}
                stroke="white"
                stroke-width="1.5"
              />
              <text x={t.x} y={t.y + 1} text-anchor="middle" dominant-baseline="central" class="unit-label">F</text>
            {/if}
          </g>
        {/if}
      </g>
    {/each}
  </svg>

  {#if selectedTerritory}
    <div class="territory-info" transition:fade={{ duration: 200 }}>
      <h3>{TERRITORIES[selectedTerritory].name}</h3>
      <p class="territory-type">{TERRITORIES[selectedTerritory].type === 'sea' ? 'Sea zone' : 'Land territory'}</p>
      {#if getUnitAt(selectedTerritory)}
        {@const unit = getUnitAt(selectedTerritory)!}
        <p class="unit-info">
          <span class="nation-dot" style="background: {NATIONS[unit.nation]}"></span>
          {unit.nation} {unit.type}
        </p>
      {:else}
        <p class="empty">No units</p>
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
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  }

  .territory {
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .territory:hover {
    opacity: 0.85;
  }

  .territory-label {
    font-size: 11px;
    font-weight: 600;
    fill: #374151;
    pointer-events: none;
    user-select: none;
  }

  .territory-label.sea {
    fill: #2563eb;
    font-size: 10px;
    font-weight: 500;
  }

  .unit-label {
    font-size: 11px;
    font-weight: 700;
    fill: white;
    pointer-events: none;
  }

  .territory-info {
    position: absolute;
    bottom: 16px;
    left: 16px;
    background: white;
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
    min-width: 160px;
  }

  .territory-info h3 {
    margin: 0 0 4px;
    font-size: 16px;
    color: #1a202c;
  }

  .territory-type {
    margin: 0 0 6px;
    font-size: 12px;
    color: #718096;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .unit-info {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: #2d3748;
  }

  .nation-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }

  .empty {
    margin: 0;
    font-size: 13px;
    color: #a0aec0;
    font-style: italic;
  }
</style>
