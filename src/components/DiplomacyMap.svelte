<script lang="ts">
  import { onMount } from 'svelte'
  import type { Unit } from '../lib/game'
  import type { MapDefinition } from '../lib/mapDefinition'
  import { DiplicityMap, type OrderState } from '../lib/map/mapRenderer'
  import { toRenderState } from '../lib/map/renderState'
  import { toGameId } from '../lib/map/idMap'
  import { renderableProvinces } from '../lib/map/coasts'

  export let mapDef: MapDefinition
  export let units: Unit[] = []
  export let ownership: Record<string, string> = {}
  export let selectedTerritory: string | null = null
  export let orders: OrderState[] | undefined = undefined
  export let interactive: boolean = true
  /** dSVG ids to highlight (also reveals named coasts, hiding their parent). */
  export let highlighted: string[] = []
  /** Explicit set of clickable dSVG ids. When null, derived from `highlighted`. */
  export let selectable: string[] | null = null
  /** When set, the parent owns selection — receives the clicked dSVG id. */
  export let onProvinceClick: ((dsvgId: string) => void) | null = null

  // Which regions are interactive. An explicit `selectable` wins; otherwise show
  // main provinces by default and reveal coasts only where highlighted.
  $: allRegionIds = [...provincePaths.keys(), ...namedCoastPaths.keys()]
  $: renderableSet = new Set(selectable ?? renderableProvinces(allRegionIds, highlighted))

  let renderer: DiplicityMap | null = null
  let hitPaths: [string, string][] = []
  let provincePaths = new Map<string, string>()
  let namedCoastPaths = new Map<string, string>()
  let viewBox = { minX: 0, minY: 0, width: 0, height: 0 }
  let loadError: string | null = null

  let svgEl: SVGSVGElement | undefined
  let hoveredProvince: string | null = null

  // pan / zoom
  let k = 1
  let tx = 0
  let ty = 0
  let panning = false
  let moved = false
  let last = { x: 0, y: 0 }
  const MIN_K = 1
  const MAX_K = 8

  onMount(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}maps/classical.dsvg`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const svg = await res.text()
      renderer = new DiplicityMap(svg)
      viewBox = renderer.viewBox
      provincePaths = renderer.provincePaths
      namedCoastPaths = renderer.namedCoastPaths
      hitPaths = [...provincePaths.entries(), ...namedCoastPaths.entries()]
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    }
  })

  // Static markup layers ABOVE the hover highlight (everything after province fills).
  const ABOVE_LAYERS = [
    'supply-center-markers',
    'province-names',
    'borders',
    'foreground',
    'units',
    'orders',
  ]

  function stripWrapper(svg: string): string {
    const openEnd = svg.indexOf('>')
    const closeStart = svg.lastIndexOf('</svg>')
    if (openEnd === -1 || closeStart === -1) return svg
    return svg.slice(openEnd + 1, closeStart).trim()
  }

  function split(inner: string): { below: string; above: string } {
    const candidates = ABOVE_LAYERS.map((id) => inner.indexOf(`<g id="${id}">`)).filter(
      (i) => i !== -1
    )
    if (candidates.length === 0) return { below: inner, above: '' }
    const at = Math.min(...candidates)
    return { below: inner.slice(0, at), above: inner.slice(at) }
  }

  $: rendered =
    renderer && viewBox.width
      ? split(
          stripWrapper(
            renderer.render(
              toRenderState({ mapDef, units, ownership, selectedTerritory, highlighted, orders })
            )
          )
        )
      : { below: '', above: '' }

  $: hoveredPath =
    hoveredProvince ? provincePaths.get(hoveredProvince) ?? namedCoastPaths.get(hoveredProvince) : undefined
  $: hoveredIsSelected =
    hoveredProvince !== null && selectedTerritory !== null && toGameId(hoveredProvince) === selectedTerritory

  function handleEnter(id: string, e: PointerEvent) {
    if (interactive && e.pointerType === 'mouse' && renderableSet.has(id)) hoveredProvince = id
  }
  function handleLeave() {
    hoveredProvince = null
  }
  function handleClickPath(id: string) {
    if (!interactive || moved || !renderableSet.has(id)) return
    if (onProvinceClick) {
      onProvinceClick(id)
      return
    }
    const gameId = toGameId(id)
    selectedTerritory = selectedTerritory === gameId ? null : gameId
  }

  // ── pan / zoom ──────────────────────────────────────────────────────
  function pointerToView(clientX: number, clientY: number) {
    if (!svgEl) return { x: 0, y: 0, scale: 1 }
    const ctm = svgEl.getScreenCTM()
    if (!ctm) return { x: 0, y: 0, scale: 1 }
    const pt = svgEl.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const v = pt.matrixTransform(ctm.inverse())
    return { x: v.x, y: v.y, scale: ctm.a }
  }

  function onWheel(e: WheelEvent) {
    if (!interactive) return
    e.preventDefault()
    const { x: vx, y: vy } = pointerToView(e.clientX, e.clientY)
    const factor = Math.exp(-e.deltaY * 0.0015)
    const k2 = Math.min(MAX_K, Math.max(MIN_K, k * factor))
    if (k2 === k) return
    // keep the map point under the cursor fixed
    const mx = (vx - tx) / k
    const my = (vy - ty) / k
    tx = vx - mx * k2
    ty = vy - my * k2
    k = k2
    clampPan()
  }

  function onPointerDown(e: PointerEvent) {
    if (!interactive) return
    panning = true
    moved = false
    last = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: PointerEvent) {
    if (!panning) return
    const { scale } = pointerToView(e.clientX, e.clientY)
    const dx = (e.clientX - last.x) / scale
    const dy = (e.clientY - last.y) / scale
    if (Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 3) moved = true
    tx += dx
    ty += dy
    last = { x: e.clientX, y: e.clientY }
    clampPan()
  }
  function onPointerUp(e: PointerEvent) {
    panning = false
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  }

  function clampPan() {
    // don't let the map be dragged entirely out of view
    const w = viewBox.width
    const h = viewBox.height
    const minTx = w - w * k
    const minTy = h - h * k
    tx = Math.min(0, Math.max(minTx, tx))
    ty = Math.min(0, Math.max(minTy, ty))
  }

  function resetView() {
    k = 1
    tx = 0
    ty = 0
  }
</script>

<div
  class="map-wrap"
  style={viewBox.width ? `aspect-ratio:${viewBox.width}/${viewBox.height}` : 'min-height:320px'}
>
  {#if loadError}
    <div class="map-msg">Failed to load map: {loadError}</div>
  {:else if !renderer}
    <div class="map-msg">Loading map…</div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg
      bind:this={svgEl}
      role="application"
      aria-label="Diplomacy map"
      class="map-svg"
      class:grabbing={panning}
      viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      on:wheel={onWheel}
      on:pointerdown={onPointerDown}
      on:pointermove={onPointerMove}
      on:pointerup={onPointerUp}
      on:pointerleave={onPointerUp}
    >
      <g transform={`translate(${tx} ${ty}) scale(${k})`}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <g>{@html rendered.below}</g>
        {#if hoveredPath}
          <path
            d={hoveredPath}
            fill={hoveredIsSelected ? 'none' : 'rgba(255,255,255,0.55)'}
            stroke="white"
            stroke-width="5"
            pointer-events="none"
          />
        {/if}
        {#if rendered.above}
          <g>{@html rendered.above}</g>
        {/if}
        <g>
          {#each hitPaths as [id, d] (id)}
            {@const enabled = renderableSet.has(id)}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <path
              {d}
              fill="transparent"
              stroke="none"
              style={`cursor:${enabled && interactive ? 'pointer' : 'default'}`}
              pointer-events={enabled ? 'visiblePainted' : 'none'}
              on:pointerenter={(e) => handleEnter(id, e)}
              on:pointerleave={handleLeave}
              on:click={() => handleClickPath(id)}
            />
          {/each}
        </g>
      </g>
    </svg>

    {#if interactive}
      <div class="map-controls">
        <button type="button" on:click={resetView} title="Reset view">⤢</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .map-wrap {
    position: relative;
    width: 100%;
    max-height: 85vh;
    overflow: hidden;
    border-radius: 8px;
    background: #c9e0f0;
  }
  .map-svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }
  .map-svg.grabbing {
    cursor: grabbing;
  }
  .map-msg {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #555;
    font: 500 14px system-ui, sans-serif;
  }
  .map-controls {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 6px;
  }
  .map-controls button {
    width: 32px;
    height: 32px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .map-controls button:hover {
    background: #fff;
  }
</style>
