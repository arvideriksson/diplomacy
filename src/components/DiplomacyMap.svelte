<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { Unit } from '../lib/game'
  import type { MapDefinition } from '../lib/mapDefinition'
  import type { DiplicityMap, OrderState, StaticLayers } from '../lib/map/mapRenderer'
  import { loadBaseRasters, loadMap } from '../lib/map/mapCache'
  import { baseRasterScale, rasterizeSvg, type Raster } from '../lib/map/rasterize'
  import { toRenderState } from '../lib/map/renderState'
  import { DISLODGED_OFFSET } from '../lib/map/render/constants'
  import { toGameId } from '../lib/map/idMap'
  import { renderableProvinces } from '../lib/map/coasts'
  import { errorMessage } from '../lib/errors'
  import type { BubbleMenu } from '../lib/orders/bubbles'
  import ActionBubbles from './ActionBubbles.svelte'

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
  /** Mouse-only right / middle click on a clickable region. */
  export let onProvinceAuxClick: ((dsvgId: string, button: 'right' | 'middle') => void) | null = null
  /** Fill the parent container (immersive in-game view) instead of sizing by aspect ratio. */
  export let fill: boolean = false
  /** Radial action menu around a unit/center, and its pick handler. */
  export let bubbles: BubbleMenu | null = null
  export let onBubble: (id: string) => void = () => {}
  /** A tap (not a drag) that lands on nothing clickable — e.g. to dismiss a selection. */
  export let onBackgroundClick: (() => void) | null = null
  /** Open zoomed to fill the frame (cropping the long side) and centred on these dSVG
   *  ids — phones, where the letterboxed whole board leaves units too small to tap. */
  export let coverFocus: string[] | null = null
  /** Extra room to pan the board's bottom edge up past (px), e.g. above a floating bar. */
  export let padBottom: number = 0

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

  // Board point → wrapper px (inverse of pointerToView, with the pan/zoom applied).
  const toWrap = (p: { x: number; y: number }, v: { k: number; tx: number; ty: number }) => ({
    x: offsetX + scale * (v.tx + v.k * p.x - viewBox.minX),
    y: offsetY + scale * (v.ty + v.k * p.y - viewBox.minY),
  })

  // Pan so board point `p` sits at wrapper px (x, y) — the centre of the usable area by
  // default (clamped to the board).
  function centreOn(p: { x: number; y: number }, x = wrapW / 2, y = (wrapH - padBottom) / 2) {
    tx = (x - offsetX) / scale + viewBox.minX - k * p.x
    ty = (y - offsetY) / scale + viewBox.minY - k * p.y
    clampPan()
  }

  // Programmatic moves (fit toggles, reveal) glide instead of jumping.
  let gliding = false
  let glideTimer: ReturnType<typeof setTimeout> | null = null
  function glide() {
    gliding = true
    if (glideTimer) clearTimeout(glideTimer)
    glideTimer = setTimeout(() => (gliding = false), 320)
  }

  // Zoom that fills the frame (cropping the long side), centred on `coverFocus`.
  function coverFit() {
    const pts = (coverFocus ?? []).map((id) => renderer!.unitPosition(id)).filter((p): p is { x: number; y: number } => !!p)
    const cover = Math.max(wrapW / (viewBox.width * scale), wrapH / (viewBox.height * scale))
    // Closer still when the focus units sit together (a compact home like the British
    // Isles), framed with a margin — but never past 3× on the way in.
    let box = cover
    if (pts.length) {
      const pad = viewBox.width * 0.14
      const bw = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) + pad * 2
      const bh = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) + pad * 2
      box = Math.min(wrapW / (bw * scale), (wrapH - padBottom) / (bh * scale), 3)
    }
    k = Math.min(MAX_K, Math.max(MIN_K, cover, box))
    const c = pts.length
      ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }
      : { x: viewBox.minX + viewBox.width / 2, y: viewBox.minY + viewBox.height / 2 }
    centreOn(c)
  }

  // Cover fit: once, as soon as the board is laid out.
  let fitted = false
  $: if (!fitted && coverFocus && renderer && scale) {
    fitted = true
    coverFit()
  }

  /** Bring a unit into the clear part of the map — away from the edges, the top overlays
   *  and the bottom bar — so its bubbles open fully visible. */
  export function reveal(dsvgId: string) {
    const p = renderer?.unitPosition(dsvgId)
    if (!p || !scale) return
    const at = toWrap(p, { k, tx, ty })
    const side = 96
    const top = 130
    const bottom = padBottom + 70
    if (at.x < side || at.x > wrapW - side || at.y < top || at.y > wrapH - bottom) {
      glide()
      centreOn(p, wrapW / 2, Math.max(top, (wrapH - padBottom) / 2 + 30))
    }
  }

  $: bubbleAnchor = bubbles && renderer && scale ? anchorPosition(bubbles) : undefined
  function anchorPosition(menu: BubbleMenu) {
    const p = renderer!.unitPosition(menu.anchor)
    const off = menu.dislodged ? DISLODGED_OFFSET : 0
    return p && { x: p.x + off, y: p.y + off }
  }
  $: bubblePx = bubbleAnchor ? toWrap(bubbleAnchor, view) : null

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
    if (glideTimer) clearTimeout(glideTimer)
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
  // Set when a region took the click, so the wrapper's background handler (which sees
  // the same event bubble up, possibly after the region's state already changed) skips it.
  let regionClicked = false

  function handleClickPath(id: string) {
    if (!interactive || moved || !renderableSet.has(id)) return
    regionClicked = true
    if (onProvinceClick) {
      onProvinceClick(id)
      return
    }
    const gameId = toGameId(id)
    selectedTerritory = selectedTerritory === gameId ? null : gameId
  }

  // Right / middle clicks from a mouse (a touch long-press keeps its default).
  let pointerType = ''
  function handleAuxPath(id: string, e: MouseEvent, button: 'right' | 'middle') {
    if (!onProvinceAuxClick || pointerType !== 'mouse') return
    e.preventDefault()
    if (!interactive || moved || !renderableSet.has(id)) return
    onProvinceAuxClick(id, button)
  }
  function onWrapContextMenu(e: MouseEvent) {
    if (onProvinceAuxClick && pointerType === 'mouse') e.preventDefault()
  }
  // No middle-button autoscroll over the board.
  function onWrapMouseDown(e: MouseEvent) {
    if (e.button === 1 && onProvinceAuxClick) e.preventDefault()
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
    pointerType = e.pointerType
    if (!interactive) return
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    panning = true
    moved = false
    captured = false
    if (touches.size === 2) {
      pinchDist = spread().d
      moved = true // a pinch is never a click
    }
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
  function onWrapClick() {
    const handled = regionClicked
    regionClicked = false
    if (!interactive || moved || handled || !onBackgroundClick) return
    onBackgroundClick()
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

  // Keep the board in frame: a side larger than the wrapper may pan until its edge meets
  // the wrapper's (plus `padBottom`, so content under a bottom overlay can be lifted into
  // view); a smaller side stays centred.
  function clampPan() {
    if (scale) {
      const fit = (pos: number, size: number, wrap: number, pad: number) =>
        size >= wrap ? Math.min(0, Math.max(wrap - pad - size, pos)) : (wrap - size) / 2
      // Board edge in wrapper px: offset + scale·(t + (k−1)·min); solve back for t.
      const left = offsetX + scale * (tx + (k - 1) * viewBox.minX)
      const top = offsetY + scale * (ty + (k - 1) * viewBox.minY)
      tx = (fit(left, scale * k * viewBox.width, wrapW, 0) - offsetX) / scale - (k - 1) * viewBox.minX
      ty = (fit(top, scale * k * viewBox.height, wrapH, padBottom) - offsetY) / scale - (k - 1) * viewBox.minY
    }
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
  on:click={onWrapClick}
  on:contextmenu={onWrapContextMenu}
  on:mousedown={onWrapMouseDown}
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
      class:gliding
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
            stroke-linejoin="round"
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
            on:contextmenu={(e) => handleAuxPath(id, e, 'right')}
            on:auxclick={(e) => e.button === 1 && handleAuxPath(id, e, 'middle')}
          />
        {/each}
      </svg>
    </div>
    {#if bubbles && bubblePx}
      {#key bubbles.anchor + bubbles.items.map((b) => b.id).join()}
        <ActionBubbles
          items={bubbles.items}
          x={bubblePx.x}
          y={bubblePx.y}
          width={wrapW}
          height={wrapH}
          onPick={onBubble}
        />
      {/key}
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
  .stage.gliding {
    transition: transform 0.3s ease;
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
