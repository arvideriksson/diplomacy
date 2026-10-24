<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { Unit } from '../lib/game'
  import type { MapDefinition } from '../lib/mapDefinition'
  import type { DiplicityMap, OrderState, StaticLayers } from '../lib/map/mapRenderer'
  import { loadBaseRasters, loadMap } from '../lib/map/mapCache'
  import { baseRasterScale, rasterizeSvg, type Raster } from '../lib/map/rasterize'
  import { toRenderState } from '../lib/map/renderState'
  import { toGameId } from '../lib/map/idMap'
  import { renderableProvinces } from '../lib/map/coasts'
  import { errorMessage } from '../lib/errors'

  export let mapDef: MapDefinition
  export let units: Unit[] = []
  /** Dislodged units awaiting retreat — drawn offset with a retreat flag at the province
   *  they were pushed out of (now occupied by the dislodging unit). Retreat phase only. */
  export let dislodged: Unit[] = []
  export let ownership: Record<string, string> = {}
  export let selectedTerritory: string | null = null
  export let orders: OrderState[] | undefined = undefined
  export let interactive: boolean = true
  /** dSVG ids to highlight (also reveals named coasts, hiding their parent). */
  export let highlighted: string[] = []
  /** Explicit set of clickable dSVG ids. When null, derived from `highlighted`. */
  export let selectable: string[] | null = null
  /** Open build centers (green highlight) and removable units (red highlight). */
  export let buildSlots: string[] = []
  export let removeSlots: string[] = []
  /** Own units still missing an order (amber highlight) — a forget-me-not cue. */
  export let unorderedSlots: string[] = []
  /** Spotlight one nation: its supply centers flood-fill in colour, the rest dims. */
  export let spotlightNation: string = ''
  /** When set, the parent owns selection — receives the clicked dSVG id. */
  export let onProvinceClick: ((dsvgId: string) => void) | null = null
  /** Fill the parent container (immersive in-game view) instead of sizing by aspect ratio. */
  export let fill: boolean = false

  // Which regions are interactive. An explicit `selectable` wins; otherwise show
  // main provinces by default and reveal coasts only where highlighted.
  $: allRegionIds = [...provincePaths.keys(), ...namedCoastPaths.keys()]
  $: renderableSet = new Set(selectable ?? renderableProvinces(allRegionIds, highlighted))

  let renderer: DiplicityMap | null = null
  let hitPaths: [string, string][] = []
  let provincePaths = new Map<string, string>()
  let namedCoastPaths = new Map<string, string>()
  let viewBox = { minX: 0, minY: 0, width: 0, height: 0 }
  // Generated ids (clip paths, spotlight mask) are prefixed per instance, as several maps can
  // share a page.
  const idPrefix = `m${Math.random().toString(36).slice(2)}-`
  let loadError: string | null = null

  // The static art (sea, coasts, borders) never changes during a game and is by far
  // the most expensive part to draw, so it is shown as bitmaps (see rasterize.ts): a
  // full-board base, plus a viewport-sized `detail` raster at the current zoom so it stays
  // crisp when zoomed in. Until the base is ready the live vector markup stands in.
  let staticLayers: StaticLayers | null = null
  let baseRasters: { below: Raster; above: Raster } | null = null
  let detail: { below: Raster; above: Raster } | null = null

  let wrapEl: HTMLDivElement | undefined
  let hoveredProvince: string | null = null

  // pan / zoom — `k`/`tx`/`ty` change on every pointer event; `view` is what's drawn, synced
  // to them at most once per animation frame.
  let k = 1
  let tx = 0
  let ty = 0
  let view = { k, tx, ty }
  let frameRequest: number | null = null
  let panning = false
  let moved = false
  let last = { x: 0, y: 0 }
  const MIN_K = 1
  const MAX_K = 8

  onMount(async () => {
    try {
      renderer = await loadMap(mapDef.id)
      viewBox = renderer.viewBox
      provincePaths = renderer.provincePaths
      namedCoastPaths = renderer.namedCoastPaths
      hitPaths = [...provincePaths.entries(), ...namedCoastPaths.entries()]
      staticLayers = renderer.renderStatic(toRenderState({ mapDef }))
    } catch (e) {
      loadError = errorMessage(e)
      return
    }
    try {
      baseRasters = await loadBaseRasters(mapDef.id, renderer, staticLayers)
      refreshDetail()
    } catch {
      // Keep the live vector layers.
    }
  })

  // ── layout ──────────────────────────────────────────────────────────
  // The board is letterboxed into the wrapper (like preserveAspectRatio="meet"); the stage div
  // covers exactly the board, so every layer <svg> inside it shares one coordinate system and
  // one CSS transform.
  let wrapW = 0
  let wrapH = 0
  $: scale = viewBox.width && wrapW && wrapH ? Math.min(wrapW / viewBox.width, wrapH / viewBox.height) : 0
  $: offsetX = (wrapW - viewBox.width * scale) / 2
  $: offsetY = (wrapH - viewBox.height * scale) / 2
  // A board point u is drawn at view coord tx + k·u (pan/zoom applied around the viewBox
  // origin), i.e. at stage px scale·(tx + k·u − min). As a CSS transform about the stage's
  // top-left corner (where u = min sits):
  $: stageTransform =
    `translate(${scale * (view.tx + viewBox.minX * (view.k - 1))}px, ` +
    `${scale * (view.ty + viewBox.minY * (view.k - 1))}px) scale(${view.k})`
  $: viewBoxAttr = `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`

  onMount(() => {
    if (!wrapEl) return
    const ro = new ResizeObserver(([entry]) => {
      wrapW = entry.contentRect.width
      wrapH = entry.contentRect.height
      gestureTick()
    })
    ro.observe(wrapEl)
    return () => ro.disconnect()
  })

  // ── gestures & detail raster ────────────────────────────────────────
  // While a pan/zoom is in flight the stage is promoted to its own compositor layer
  // (will-change: transform) so moving it is a GPU translate/scale, not a repaint. Once the
  // gesture settles it is demoted again — so it re-rasterizes crisp at the final zoom — and a
  // detail raster of the visible region is rendered at the new resolution.
  let gesturing = false
  let gestureTimer: ReturnType<typeof setTimeout> | null = null
  const GESTURE_SETTLE_MS = 180

  function gestureTick() {
    gesturing = true
    if (gestureTimer) clearTimeout(gestureTimer)
    gestureTimer = setTimeout(() => {
      gestureTimer = null
      gesturing = false
      refreshDetail()
    }, GESTURE_SETTLE_MS)
  }

  function scheduleView() {
    gestureTick()
    if (frameRequest !== null) return
    frameRequest = requestAnimationFrame(() => {
      frameRequest = null
      view = { k, tx, ty }
    })
  }

  // Margin around the visible region, so small pans after a zoom stay on the detail raster.
  const DETAIL_MARGIN = 0.15
  const DETAIL_MAX_PX = 4096
  let detailGen = 0

  function setDetail(next: { below: Raster; above: Raster } | null) {
    if (detail) {
      URL.revokeObjectURL(detail.below.url)
      URL.revokeObjectURL(detail.above.url)
    }
    detail = next
  }

  async function refreshDetail() {
    if (!staticLayers || !baseRasters || !scale) return
    const gen = ++detailGen
    const pxPerUnit = k * scale * (window.devicePixelRatio || 1)
    // The base raster is already sharp enough at this zoom.
    if (pxPerUnit <= baseRasterScale(viewBox) * 1.1) {
      setDetail(null)
      return
    }
    // Visible part of the board in board units — invert stage px = scale·(t + k·u − min).
    const toBoard = (px: number, t: number, min: number) => (px / scale - t + min) / k
    const vx0 = toBoard(-offsetX, tx, viewBox.minX)
    const vx1 = toBoard(wrapW - offsetX, tx, viewBox.minX)
    const vy0 = toBoard(-offsetY, ty, viewBox.minY)
    const vy1 = toBoard(wrapH - offsetY, ty, viewBox.minY)
    const mx = (vx1 - vx0) * DETAIL_MARGIN
    const my = (vy1 - vy0) * DETAIL_MARGIN
    const x0 = Math.max(viewBox.minX, vx0 - mx)
    const y0 = Math.max(viewBox.minY, vy0 - my)
    const x1 = Math.min(viewBox.minX + viewBox.width, vx1 + mx)
    const y1 = Math.min(viewBox.minY + viewBox.height, vy1 + my)
    if (x1 <= x0 || y1 <= y0) return
    const region = { minX: x0, minY: y0, width: x1 - x0, height: y1 - y0 }
    const res = Math.min(pxPerUnit, DETAIL_MAX_PX / region.width, DETAIL_MAX_PX / region.height)
    const px = { w: region.width * res, h: region.height * res }
    const { defs, rootFill, below, above } = staticLayers
    const [b, a] = await Promise.all([
      rasterizeSvg(below, defs, rootFill, region, px),
      rasterizeSvg(above, defs, rootFill, region, px),
    ])
    if (gen !== detailGen) {
      URL.revokeObjectURL(b.url)
      URL.revokeObjectURL(a.url)
      return
    }
    setDetail({ below: b, above: a })
  }

  onDestroy(() => {
    detailGen++
    setDetail(null)
    if (gestureTimer) clearTimeout(gestureTimer)
    if (frameRequest !== null) cancelAnimationFrame(frameRequest)
  })

  // ── spotlight veil fade ─────────────────────────────────────────────
  // `spotlightNation` is the live hover target. The darkening eases in and out instead of
  // snapping (which flashbanged the board when scanning the SC card). Two derived pieces
  // make that possible: `veilNation` — whose holding the mask punches out; it lingers
  // through the fade-out so the mask stays correct while opacity animates to 0 — and
  // `veilOn`, the opacity target the CSS transition rides. The pulsing white unit outlines
  // ride this same fading layer (see spotlightOverlayLayer), so they fade in/out with the
  // veil rather than snapping on/off.
  let veilNation = ''
  let veilOn = false
  let veilClearTimer: ReturnType<typeof setTimeout> | null = null
  const VEIL_FADE_MS = 1000

  $: {
    if (spotlightNation) {
      if (veilClearTimer) { clearTimeout(veilClearTimer); veilClearTimer = null }
      veilNation = spotlightNation
      veilOn = true
    } else if (veilOn) {
      veilOn = false
      if (veilClearTimer) clearTimeout(veilClearTimer)
      veilClearTimer = setTimeout(() => { veilClearTimer = null; veilNation = '' }, VEIL_FADE_MS)
    }
  }

  // Each layer is its own string, so Svelte only re-parses the ones that actually changed
  // (e.g. a selection changes `fills`/`pulse` but leaves arrows and units alone).
  $: dynamic = renderer
    ? renderer.renderDynamic(
        toRenderState({ mapDef, units, dislodged, ownership, selectedTerritory, highlighted, buildSlots, removeSlots, unorderedSlots, orders }),
        idPrefix,
      )
    : null
  $: fillsMarkup = dynamic?.fills ?? ''
  $: pulseMarkup = dynamic?.pulse ?? ''
  $: overlayMarkup = dynamic?.overlay ?? ''

  // The veil rides its own persistent layer (mask + dark rect at SPOTLIGHT_SHADOW_OPACITY);
  // the wrapper multiplies that by 0→1 with a CSS transition for the gradual fade.
  // `orders` is required here, not just decorative: the redrawn units resolve their addons
  // (disband "−" vs. retreat flag) from the order set, so omitting it would lift a bright
  // retreat flag over the veil on a unit that's actually being disbanded.
  $: spotlight =
    renderer && veilNation
      ? renderer.renderSpotlight(
          toRenderState({ mapDef, units, dislodged, ownership, spotlightNation: veilNation, orders }),
          idPrefix,
        )
      : null

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
  // Client point → view coords (before the pan/zoom transform), from the untransformed
  // wrapper's box, so it is independent of the stage's CSS transform.
  function pointerToView(clientX: number, clientY: number) {
    if (!wrapEl || !scale) return { x: 0, y: 0, scale: 1 }
    const rect = wrapEl.getBoundingClientRect()
    return {
      x: (clientX - rect.left - offsetX) / scale + viewBox.minX,
      y: (clientY - rect.top - offsetY) / scale + viewBox.minY,
      scale,
    }
  }

  function onWheel(e: WheelEvent) {
    if (!interactive) return
    e.preventDefault()
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015))
  }

  // Zoom by `factor` keeping the map point under (clientX, clientY) fixed.
  function zoomAt(clientX: number, clientY: number, factor: number) {
    const { x: vx, y: vy } = pointerToView(clientX, clientY)
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

  // Two-finger pinch on touch screens: active pointers and the last pinch spread.
  const touches = new Map<number, { x: number; y: number }>()
  let pinchDist = 0
  const spread = () => {
    const [a, b] = [...touches.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
  }

  let captured = false
  function onPointerDown(e: PointerEvent) {
    if (!interactive) return
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size === 2) {
      pinchDist = spread().d
      moved = true // a pinch is never a click
    }
    panning = true
    moved = false
    captured = false
    last = { x: e.clientX, y: e.clientY }
    // NOTE: do NOT capture the pointer here — capturing on press retargets the
    // synthesized `click` to the wrapper, so a plain click never reaches a region's
    // on:click. Capture lazily once a real drag begins (see onPointerMove).
  }
  function onPointerMove(e: PointerEvent) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size === 2) {
      const { d, cx, cy } = spread()
      if (pinchDist > 0) zoomAt(cx, cy, d / pinchDist)
      pinchDist = d
      return
    }
    if (!panning) return
    const { scale: s } = pointerToView(e.clientX, e.clientY)
    const dx = (e.clientX - last.x) / s
    const dy = (e.clientY - last.y) / s
    if (!moved && Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 3) {
      moved = true
      try {
        ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
        captured = true
      } catch {
        captured = false
      }
    }
    tx += dx
    ty += dy
    last = { x: e.clientX, y: e.clientY }
    clampPan()
  }
  function onPointerUp(e: PointerEvent) {
    touches.delete(e.pointerId)
    pinchDist = 0
    if (touches.size === 1) {
      // continue panning with the remaining finger from where it is now
      last = { ...[...touches.values()][0] }
      return
    }
    panning = false
    if (captured) {
      ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
      captured = false
    }
  }

  function clampPan() {
    // don't let the map be dragged entirely out of view
    const w = viewBox.width
    const h = viewBox.height
    const minTx = w - w * k
    const minTy = h - h * k
    tx = Math.min(0, Math.max(minTx, tx))
    ty = Math.min(0, Math.max(minTy, ty))
    scheduleView()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={wrapEl}
  class="map-wrap"
  class:fill
  class:grabbing={panning}
  role="application"
  aria-label="Diplomacy map"
  style={fill ? '' : viewBox.width ? `aspect-ratio:${viewBox.width}/${viewBox.height}` : 'min-height:320px'}
  on:wheel={onWheel}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointerleave={onPointerUp}
  on:pointercancel={onPointerUp}
>
  {#if loadError}
    <div class="map-msg">Failed to load map: {loadError}</div>
  {:else if !renderer || !staticLayers}
    <div class="map-msg">Loading map…</div>
  {:else if scale}
    <!-- One transformed stage; each layer is its own <svg> so the compositor can animate the
         pulse and the spotlight fade without repainting the board beneath them. -->
    <div
      class="stage"
      class:gesturing
      style={`left:${offsetX}px;top:${offsetY}px;width:${viewBox.width * scale}px;height:${viewBox.height * scale}px;transform:${stageTransform}`}
    >
      <svg class="layer" viewBox={viewBoxAttr} preserveAspectRatio="none" fill={staticLayers.rootFill ?? undefined}>
        {#if baseRasters}
          <image href={baseRasters.below.url} x={viewBox.minX} y={viewBox.minY} width={viewBox.width} height={viewBox.height} preserveAspectRatio="none" />
          {#if detail}
            <image href={detail.below.url} x={detail.below.region.minX} y={detail.below.region.minY} width={detail.below.region.width} height={detail.below.region.height} preserveAspectRatio="none" />
          {/if}
        {:else}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html staticLayers.defs + staticLayers.below}
        {/if}
      </svg>
      <svg class="layer" viewBox={viewBoxAttr} preserveAspectRatio="none">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <g>{@html fillsMarkup}</g>
        {#if hoveredPath}
          <path
            d={hoveredPath}
            fill={hoveredIsSelected ? 'none' : 'rgba(255,255,255,0.55)'}
            stroke="white"
            stroke-width="5"
          />
        {/if}
      </svg>
      {#if pulseMarkup}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <svg class="layer pulse" viewBox={viewBoxAttr} preserveAspectRatio="none">{@html pulseMarkup}</svg>
      {/if}
      <!-- Supply-center markers and names stay vector (crisp at any zoom; cheap to paint). The
           defs carry the dsvg's embedded label font. Static, so parsed once. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <svg class="layer" viewBox={viewBoxAttr} preserveAspectRatio="none" fill={staticLayers.rootFill ?? undefined}>{@html staticLayers.defs + staticLayers.labels}</svg>
      <svg class="layer" viewBox={viewBoxAttr} preserveAspectRatio="none" fill={staticLayers.rootFill ?? undefined}>
        {#if baseRasters}
          <image href={baseRasters.above.url} x={viewBox.minX} y={viewBox.minY} width={viewBox.width} height={viewBox.height} preserveAspectRatio="none" />
          {#if detail}
            <image href={detail.above.url} x={detail.above.region.minX} y={detail.above.region.minY} width={detail.above.region.width} height={detail.above.region.height} preserveAspectRatio="none" />
          {/if}
        {:else}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html staticLayers.defs + staticLayers.above}
        {/if}
      </svg>
      {#if overlayMarkup}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <svg class="layer" viewBox={viewBoxAttr} preserveAspectRatio="none">{@html overlayMarkup}</svg>
      {/if}
      <!-- Persistent so the wrapper sits at opacity 0 before the first hover; the fade-in
           transition needs that prior state to animate from (a freshly-mounted node would
           snap straight to full). -->
      <div class="layer spotlight-veil" class:on={veilOn}>
        {#if spotlight}
          <!-- eslint-disable svelte/no-at-html-tags -->
          <svg class="layer" viewBox={viewBoxAttr} preserveAspectRatio="none">{@html spotlight.veil}</svg>
          <svg class="layer pulse" viewBox={viewBoxAttr} preserveAspectRatio="none">{@html spotlight.halos}</svg>
          <svg class="layer" viewBox={viewBoxAttr} preserveAspectRatio="none">{@html spotlight.lifted}</svg>
          <!-- eslint-enable svelte/no-at-html-tags -->
        {/if}
      </div>
      <svg class="layer hit" viewBox={viewBoxAttr} preserveAspectRatio="none">
        {#each hitPaths as [id, d] (id)}
          {@const enabled = renderableSet.has(id)}
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <path
            {d}
            data-province={id}
            data-selectable={enabled}
            fill="transparent"
            stroke="none"
            style={`cursor:${enabled && interactive ? 'pointer' : 'default'}`}
            pointer-events={enabled ? 'visiblePainted' : 'none'}
            on:pointerenter={(e) => handleEnter(id, e)}
            on:pointerleave={handleLeave}
            on:click={() => handleClickPath(id)}
          />
        {/each}
      </svg>
    </div>
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
    touch-action: none;
    cursor: grab;
    /* stop pan drags from selecting province-name text */
    user-select: none;
    -webkit-user-select: none;
  }
  .map-wrap.fill {
    height: 100%;
    max-height: none;
    border-radius: 0;
    /* letterbox margins match the app theme (dark in dark mode) instead of sea-blue */
    background: var(--bg, #0b0e14);
  }
  .map-wrap.grabbing {
    cursor: grabbing;
  }
  .stage {
    position: absolute;
    transform-origin: 0 0;
  }
  /* Promoted only mid-gesture: a GPU-moved layer while panning/zooming, then demoted so the
     board re-rasterizes crisp at the settled zoom instead of staying a scaled bitmap. */
  .stage.gesturing {
    will-change: transform;
  }
  .layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    overflow: hidden;
    pointer-events: none;
  }
  .layer.hit {
    pointer-events: auto;
  }
  /* Highlight borders breathe by opacity on their own layer — a compositor-only animation,
     so the board isn't repainted every frame while a highlight is showing. */
  .pulse {
    animation: map-pulse 2s ease-in-out infinite;
    will-change: opacity;
  }
  @keyframes map-pulse {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }
  /* The veil starts transparent and eases to full on hover — no snap-to-dark flashbang
     when scanning the SC card. Fade-out runs as `veilNation` lingers post-hover. */
  .spotlight-veil {
    opacity: 0;
    transition: opacity 1s ease;
    will-change: opacity;
  }
  .spotlight-veil.on {
    opacity: 1;
  }
  .map-msg {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #555;
    font: 500 14px system-ui, sans-serif;
  }
</style>
