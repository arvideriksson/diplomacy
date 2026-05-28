<script lang="ts">
  import { onMount, afterUpdate } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import type { Unit } from '../lib/game'
  import type { MapDefinition, PowerDefinition } from '../lib/mapDefinition'

  export let mapDef: MapDefinition
  export let units: Unit[] = []
  export let selectedTerritory: string | null = null
  export let ownership: Record<string, string> = {}
  export let isAdmin: boolean = false

  let svgEl: SVGSVGElement | undefined
  let editingCoasts = false
  let coastTargeting = false
  let dragging: { id: string; coastId: string } | null = null
  let hoveredTerritory: string | null = null
  let hoveredCoast: string | null = null

  let editPositions: Record<string, Record<string, [number, number]>> = {}

  $: powerMap = Object.fromEntries(mapDef.powers.map((p) => [p.id, p]))

  $: coastPositions = (() => {
    const pos: Record<string, Record<string, [number, number]>> = {}
    for (const [id, t] of Object.entries(mapDef.territories)) {
      if (!t.coasts) continue
      pos[id] = {}
      for (const coastId of Object.keys(t.coasts)) {
        pos[id][coastId] = editPositions[id]?.[coastId] ?? t.coasts[coastId].render.center
      }
    }
    return pos
  })()

  function getPower(id: string): PowerDefinition | undefined {
    return powerMap[id]
  }

  function getUnitAt(territory: string): Unit | undefined {
    return units.find((u) => u.territory === territory)
  }

  function blendHex(hex: string, amount: number): string {
    const base = [255, 255, 221] // #ffffdd — land territory base
    const r = Math.round(base[0] * (1 - amount) + parseInt(hex.slice(1, 3), 16) * amount)
    const g = Math.round(base[1] * (1 - amount) + parseInt(hex.slice(3, 5), 16) * amount)
    const b = Math.round(base[2] * (1 - amount) + parseInt(hex.slice(5, 7), 16) * amount)
    return `rgb(${r},${g},${b})`
  }

  function territoryFill(id: string): string {
    const t = mapDef.territories[id]
    if (!t) return ''
    if (t.type === 'sea') return ''
    const owner = ownership[id]
    if (owner) {
      const color = getPower(owner)?.color
      return color ? blendHex(color, 0.25) : ''
    }
    const unit = getUnitAt(id)
    if (unit) {
      const p = getPower(unit.nation)
      return p ? blendHex(p.color, 0.15) : ''
    }
    return ''
  }

  function findTerritoryFromElement(el: Element): string | null {
    const text = el.closest('g')?.querySelector('text[data-territory]')
    return text?.getAttribute('data-territory') ?? null
  }

  function handleSvgClick(e: MouseEvent) {
    if (editingCoasts) return
    const target = e.target as Element
    const id = findTerritoryFromElement(target)
    if (id && mapDef.territories[id]) {
      selectedTerritory = selectedTerritory === id ? null : id
    }
  }

  function unitColor(unit: Unit): string {
    return getPower(unit.nation)?.color ?? '#888'
  }

  function applyFills() {
    if (!svgEl) return
    for (const [id, t] of Object.entries(mapDef.territories)) {
      const textEl = svgEl.querySelector(`text[data-territory="${id}"]`)
      if (!textEl) continue
      const group = textEl.closest('g')
      if (!group) continue

      const paths = group.querySelectorAll('path')
      const fill = territoryFill(id)
      const isSelected = selectedTerritory === id
      const isHovered = hoveredTerritory === id

      paths.forEach((path) => {
        if (fill) {
          path.style.fill = fill
        } else {
          path.style.fill = ''
        }

        if (isSelected) {
          path.style.stroke = '#f59e0b'
          path.style.strokeWidth = '2'
        } else {
          path.style.stroke = ''
          path.style.strokeWidth = ''
        }

        path.style.filter = isHovered ? 'saturate(3) brightness(0.7)' : ''
      })
    }
  }

  function screenToSvg(e: MouseEvent): [number, number] {
    if (!svgEl) return [0, 0]
    const ctm = svgEl.getScreenCTM()
    if (!ctm) return [0, 0]
    return [
      (e.clientX - ctm.e) / ctm.a,
      (e.clientY - ctm.f) / ctm.d,
    ]
  }

  function onCoastMouseDown(id: string, coastId: string, e: MouseEvent) {
    if (!editingCoasts) return
    e.preventDefault()
    e.stopPropagation()
    dragging = { id, coastId }
  }

  function onSvgMouseMove(e: MouseEvent) {
    if (dragging) {
      e.preventDefault()
      const [x, y] = screenToSvg(e)
      const { id, coastId } = dragging
      editPositions = {
        ...editPositions,
        [id]: { ...(editPositions[id] ?? {}), [coastId]: [Math.round(x), Math.round(y)] },
      }
      return
    }
    const target = e.target as Element
    const id = findTerritoryFromElement(target)
    if (id !== hoveredTerritory) {
      hoveredTerritory = id
      hoveredCoast = null
    }
    if (coastTargeting && id && mapDef.territories[id]?.coasts) {
      const [mx, my] = screenToSvg(e)
      let nearest: string | null = null
      let bestDist = Infinity
      for (const [coastId, pos] of Object.entries(coastPositions[id] ?? {})) {
        const dx = mx - pos[0], dy = my - pos[1]
        const dist = dx * dx + dy * dy
        if (dist < bestDist) { bestDist = dist; nearest = coastId }
      }
      hoveredCoast = nearest
    } else {
      hoveredCoast = null
    }
  }

  function onSvgMouseUp() {
    dragging = null
  }

  function onSvgMouseLeave() {
    dragging = null
    hoveredTerritory = null
    hoveredCoast = null
  }

  function exportPositions() {
    const lines: string[] = []
    for (const [id, coasts] of Object.entries(coastPositions)) {
      for (const [coastId, pos] of Object.entries(coasts)) {
        lines.push(`${id} ${coastId}: [${pos[0]}, ${pos[1]}]`)
      }
    }
    navigator.clipboard.writeText(JSON.stringify(coastPositions, null, 2))
    alert('Coast positions copied to clipboard!\n\n' + lines.join('\n'))
  }

  function toggleEditMode() {
    editingCoasts = !editingCoasts
    if (editingCoasts) {
      editPositions = {}
    }
  }

  onMount(applyFills)
  afterUpdate(applyFills)
  $: hoveredTerritory, hoveredCoast, selectedTerritory, ownership, units, applyFills()
</script>

<div class="map-container">
  {#if isAdmin}
    <div class="edit-controls">
      <button class="edit-btn" class:active={coastTargeting} on:click={() => { coastTargeting = !coastTargeting; hoveredCoast = null }}>
        {coastTargeting ? 'Normal Mode' : 'Coast Targeting'}
      </button>
      <button class="edit-btn" class:active={editingCoasts} on:click={toggleEditMode}>
        {editingCoasts ? 'Exit Coast Edit' : 'Edit Coasts'}
      </button>
      {#if editingCoasts}
        <button class="edit-btn export" on:click={exportPositions}>
          Copy Positions
        </button>
      {/if}
    </div>
  {/if}

  {#if editingCoasts}
    <div class="coord-display">
      {#each Object.entries(coastPositions) as [id, coasts]}
        {#each Object.entries(coasts) as [coastId, pos]}
          <span class="coord">{id}({coastId}): [{pos[0]}, {pos[1]}]</span>
        {/each}
      {/each}
    </div>
  {/if}

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <svg
    bind:this={svgEl}
    viewBox={mapDef.viewBox}
    xmlns="http://www.w3.org/2000/svg"
    on:click={handleSvgClick}
    on:mousemove={onSvgMouseMove}
    on:mouseup={onSvgMouseUp}
    on:mouseleave={onSvgMouseLeave}
    class="diplomacy-svg"
    class:editing={editingCoasts}
  >
    {@html mapDef.svgContent}

    <!-- Coast labels -->
    {#each Object.entries(mapDef.territories) as [id, t] (id)}
      {#if t.coasts}
        {#each Object.entries(t.coasts) as [coastId, _coast]}
          {@const pos = coastPositions[id]?.[coastId]}
          {@const cx = pos?.[0] ?? 0}
          {@const cy = pos?.[1] ?? 0}
          {@const isActive = coastTargeting && hoveredTerritory === id && hoveredCoast === coastId}
          {#if editingCoasts}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <text
              x={cx} y={cy}
              text-anchor="middle"
              dominant-baseline="central"
              class="coast-label editable"
              on:mousedown={(e) => onCoastMouseDown(id, coastId, e)}
            >
              {coastId}
            </text>
          {:else}
            <text
              x={cx} y={cy}
              text-anchor="middle"
              dominant-baseline="central"
              class="coast-label"
              class:active={isActive}
              class:targeting={coastTargeting && hoveredTerritory === id}
            >
              {coastId}
            </text>
          {/if}
        {/each}
      {/if}
    {/each}

    <!-- Units -->
    {#each units as unit (unit.territory)}
      {@const t = mapDef.territories[unit.territory]}
      {#if t}
        {@const coastPos = unit.coast ? coastPositions[unit.territory]?.[unit.coast] : null}
        {@const [cx, cy] = coastPos ?? t.render.center}
        <g transition:scale={{ duration: 300, easing: cubicOut }}>
          {#if unit.type === 'army'}
            <rect
              x={cx - 6} y={cy + 4}
              width="12" height="12" rx="2"
              fill={unitColor(unit)} stroke="white" stroke-width="1"
            />
            <text x={cx} y={cy + 10} text-anchor="middle" dominant-baseline="central" class="unit-label">A</text>
          {:else}
            <polygon
              points="{cx},{cy + 2} {cx + 7},{cy + 13} {cx - 7},{cy + 13}"
              fill={unitColor(unit)} stroke="white" stroke-width="1"
            />
            <text x={cx} y={cy + 9} text-anchor="middle" dominant-baseline="central" class="unit-label">F</text>
          {/if}
        </g>
      {/if}
    {/each}
  </svg>

  {#if selectedTerritory && !editingCoasts}
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
      {#if terr.coasts}
        <div class="coast-info">
          Coasts: {Object.entries(terr.coasts).map(([k, c]) => c.name).join(', ')}
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

  :global(.diplomacy-svg) {
    width: 100%;
    height: auto;
    border-radius: var(--radius-lg, 14px);
    box-shadow: var(--shadow-lg, 0 8px 30px rgba(0, 0, 0, 0.08));
    cursor: pointer;
  }

  :global(.diplomacy-svg.editing) {
    cursor: default;
  }

  :global(.diplomacy-svg g) {
    cursor: pointer;
  }

  .coast-label {
    font-size: 8px;
    font-weight: 600;
    fill: #666;
    pointer-events: none;
    user-select: none;
    font-family: 'Liberation Sans', sans-serif;
    font-style: italic;
  }

  .coast-label.targeting {
    font-size: 9px;
    fill: #999;
  }

  .coast-label.active {
    font-size: 10px;
    font-weight: 700;
    fill: #c00;
    stroke: white;
    stroke-width: 1.5px;
    paint-order: stroke;
  }

  .coast-label.editable {
    font-size: 12px;
    font-weight: 700;
    fill: #d00;
    pointer-events: all;
    cursor: grab;
    stroke: white;
    stroke-width: 2px;
    paint-order: stroke;
  }

  .coast-label.editable:active {
    cursor: grabbing;
  }

  .unit-label {
    font-size: 7px;
    font-weight: 700;
    fill: white;
    pointer-events: none;
    font-family: var(--font, system-ui);
  }

  .edit-controls {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  .edit-btn {
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-md, 8px);
    background: var(--bg-card, white);
    color: var(--text, #333);
    cursor: pointer;
    font-family: var(--font, system-ui);
  }

  .edit-btn.active {
    background: #dc2626;
    color: white;
    border-color: #dc2626;
  }

  .edit-btn.export {
    background: #2563eb;
    color: white;
    border-color: #2563eb;
  }

  .coord-display {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
    padding: 8px 12px;
    background: var(--bg-card, white);
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-md, 8px);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }

  .coord {
    padding: 2px 6px;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 4px;
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

  .territory-type-badge.sea { background: rgba(37, 99, 235, 0.08); color: #2563eb; }
  .territory-type-badge.coast { background: rgba(14, 165, 233, 0.1); color: #0ea5e9; }

  .sc-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: var(--radius-full, 9999px);
    background: rgba(234, 179, 8, 0.12);
    color: #ca8a04;
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
  }

  .nation-name { font-weight: 600; color: var(--text, #1a1a1a); }
  .unit-type { color: var(--text-tertiary, #8c8c8c); text-transform: capitalize; }

  .coast-info {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-secondary, #666);
    font-style: italic;
  }
</style>
