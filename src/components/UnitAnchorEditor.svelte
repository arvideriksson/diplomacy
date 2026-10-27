<script lang="ts">
  // Dev-only editor for where units stand on each province and named coast (the board's
  // `unit-positions` layer). Saves through the Vite dev server (scripts/unitAnchorsPlugin.ts).
  import { onDestroy, onMount } from 'svelte'
  import { immersive } from '../lib/layout'
  import { maps } from '../lib/maps'
  import { DiplicityMap, type StaticLayers } from '../lib/map/mapRenderer'
  import { rasterizeSvg, type Raster } from '../lib/map/rasterize'
  import { toRenderState } from '../lib/map/renderState'
  import { toGameId } from '../lib/map/idMap'
  import { isCoast } from '../lib/map/coasts'
  import { unitToken } from '../lib/map/render/units'
  import { DEFAULT_UNIT_STYLE } from '../lib/map/unitStyles'
  import type { Point, ViewBox } from '../lib/map/dsvgParser'

  type Anchor = { id: string; at: Point; saved: Point; region?: Path2D; regionD?: string }

  const MAP_IDS = ['classical', '1900']
  const RASTER_PIXELS = 16_000_000

  immersive.set(true)
  onDestroy(() => immersive.set(false))

  let mapId = new URLSearchParams(location.search).get('map') ?? 'classical'
  if (!MAP_IDS.includes(mapId)) mapId = 'classical'

  let renderer: DiplicityMap | null = null
  let staticLayers: StaticLayers | null = null
  let rasters: { below: Raster; above: Raster } | null = null
  let board: ViewBox | null = null
  let view: ViewBox = { minX: 0, minY: 0, width: 1, height: 1 }
  let anchors: Anchor[] = []
  let selected: string | null = null
  let hovered: string | null = null
  let fleetsOnCoasts = false
  let showIds = false
  let query = ''
  let status = ''
  let saving = false
  let undoStack: { id: string; at: Point }[] = []
  let svg: SVGSVGElement
  let loadToken = 0

  const ctx = document.createElement('canvas').getContext('2d')!

  $: mapDef = maps[mapId]
  $: changed = anchors.filter((a) => a.at.x !== a.saved.x || a.at.y !== a.saved.y)
  $: selectedAnchor = anchors.find((a) => a.id === selected) ?? null
  $: focusAnchor = anchors.find((a) => a.id === (hovered ?? selected)) ?? null
  $: k = board ? board.width / view.width : 1

  const inside = (a: Anchor, p: Point = a.at): boolean => !a.region || ctx.isPointInPath(a.region, p.x, p.y, 'evenodd')

  function unitType(id: string): 'Army' | 'Fleet' {
    if (isCoast(id)) return 'Fleet'
    const type = mapDef.territories[toGameId(id)]?.type
    return type === 'sea' || (type === 'coast' && fleetsOnCoasts) ? 'Fleet' : 'Army'
  }

  function regionName(id: string): string {
    const t = mapDef.territories[toGameId(id)]
    if (!t) return id
    const coast = isCoast(id) ? t.coasts?.[id.split('/')[1]]?.name ?? id.split('/')[1].toUpperCase() : ''
    return coast ? `${t.name} (${coast})` : t.name
  }

  async function load(id: string) {
    const token = ++loadToken
    if (rasters) for (const r of Object.values(rasters)) URL.revokeObjectURL(r.url)
    renderer = null
    staticLayers = null
    rasters = null
    selected = hovered = null
    undoStack = []
    status = ''
    const res = await fetch(`${import.meta.env.BASE_URL}maps/${id}.dsvg`, { cache: 'no-store' })
    const map = new DiplicityMap(await res.text())
    if (token !== loadToken) return
    const layers = map.renderStatic(toRenderState({ mapDef: maps[id] }))
    const regions = new Map([...map.provincePaths, ...map.namedCoastPaths])
    anchors = [...map.unitPositions].map(([aid, p]) => {
      const d = regions.get(aid)
      return { id: aid, at: { ...p }, saved: { ...p }, region: d ? new Path2D(d) : undefined, regionD: d }
    })
    // Coasts last, so they sit above (and are grabbable over) their province's own anchor.
    anchors.sort((a, b) => Number(isCoast(a.id)) - Number(isCoast(b.id)) || a.id.localeCompare(b.id))
    renderer = map
    staticLayers = layers
    board = map.viewBox
    view = { ...map.viewBox }
    const vb = map.viewBox
    const scale = Math.min(3, Math.sqrt(RASTER_PIXELS / (vb.width * vb.height)))
    const px = { w: vb.width * scale, h: vb.height * scale }
    const [below, above] = await Promise.all([
      rasterizeSvg(layers.below, layers.defs, layers.rootFill, vb, px),
      rasterizeSvg(layers.above, layers.defs, layers.rootFill, vb, px),
    ])
    if (token === loadToken) rasters = { below, above }
  }

  function switchMap(id: string) {
    if (changed.length && !confirm(`Discard ${changed.length} unsaved change(s)?`)) return
    mapId = id
    const url = new URL(location.href)
    url.searchParams.set('map', id)
    history.replaceState(history.state, '', url)
    load(id)
  }

  function move(id: string, at: Point, record = true) {
    const a = anchors.find((x) => x.id === id)
    if (!a) return
    if (record) undoStack = [...undoStack, { id, at: { ...a.at } }]
    a.at = { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 }
    anchors = anchors
  }

  function undo() {
    const last = undoStack.at(-1)
    if (!last) return
    undoStack = undoStack.slice(0, -1)
    move(last.id, last.at, false)
    selected = last.id
  }

  function revert(id: string) {
    const a = anchors.find((x) => x.id === id)
    if (a) move(id, a.saved)
  }

  function discard() {
    for (const a of anchors) a.at = { ...a.saved }
    anchors = anchors
    undoStack = []
  }

  async function save() {
    if (!changed.length || saving) return
    saving = true
    status = ''
    try {
      const body = Object.fromEntries(changed.map((a) => [a.id, [a.at.x, a.at.y]]))
      const res = await fetch(`/__unit-anchors/${mapId}`, { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
      const n = changed.length
      for (const a of anchors) a.saved = { ...a.at }
      anchors = anchors
      undoStack = []
      status = `Saved ${n}`
    } catch (e) {
      status = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  // ── pointer: drag anchors, pan the board, wheel zoom ─────────────────
  let drag: { id: string; grab: Point; start: Point } | null = null
  let pan: { inverse: DOMMatrix; from: Point; view: ViewBox } | null = null

  const toBoard = (e: { clientX: number; clientY: number }, m = svg.getScreenCTM()?.inverse()): Point => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m)
    return { x: p.x, y: p.y }
  }

  function onAnchorDown(e: PointerEvent, a: Anchor) {
    if (e.button !== 0) return
    e.stopPropagation()
    selected = a.id
    const p = toBoard(e)
    drag = { id: a.id, grab: { x: p.x - a.at.x, y: p.y - a.at.y }, start: { ...a.at } }
    svg.setPointerCapture(e.pointerId)
  }

  function onBoardDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return
    const inverse = svg.getScreenCTM()?.inverse()
    if (!inverse) return
    pan = { inverse, from: toBoard(e, inverse), view: { ...view } }
    svg.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (drag) {
      const p = toBoard(e)
      const a = anchors.find((x) => x.id === drag!.id)
      if (a) {
        a.at = { x: Math.round((p.x - drag.grab.x) * 10) / 10, y: Math.round((p.y - drag.grab.y) * 10) / 10 }
        anchors = anchors
      }
    } else if (pan) {
      const p = toBoard(e, pan.inverse)
      view = { ...view, minX: pan.view.minX - (p.x - pan.from.x), minY: pan.view.minY - (p.y - pan.from.y) }
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (drag) {
      const a = anchors.find((x) => x.id === drag!.id)
      if (a && (a.at.x !== drag.start.x || a.at.y !== drag.start.y)) undoStack = [...undoStack, { id: a.id, at: drag.start }]
    } else if (pan) {
      // A click (no pan) on the board selects the province under it.
      const p = toBoard(e, pan.inverse)
      if (Math.hypot(p.x - pan.from.x, p.y - pan.from.y) < 2 / k) {
        const hit = [...anchors].reverse().find((a) => a.region && inside(a, p))
        selected = hit?.id ?? null
      }
    }
    drag = null
    pan = null
  }

  function onWheel(e: WheelEvent) {
    if (!board) return
    e.preventDefault()
    const p = toBoard(e)
    const f = Math.exp(e.deltaY * 0.0015)
    const width = Math.min(board.width * 1.2, Math.max(board.width / 16, view.width * f))
    const g = width / view.width
    view = {
      minX: p.x - (p.x - view.minX) * g,
      minY: p.y - (p.y - view.minY) * g,
      width,
      height: view.height * g,
    }
  }

  function focusOn(id: string) {
    const a = anchors.find((x) => x.id === id)
    if (!a || !board) return
    selected = id
    const width = Math.min(view.width, board.width / 4)
    const height = (view.height / view.width) * width
    view = { minX: a.at.x - width / 2, minY: a.at.y - height / 2, width, height }
  }

  function onSearch() {
    const q = query.trim().toLowerCase()
    if (!q) return
    const hit =
      anchors.find((a) => a.id === q) ??
      anchors.find((a) => regionName(a.id).toLowerCase() === q) ??
      anchors.find((a) => a.id.startsWith(q) || regionName(a.id).toLowerCase().startsWith(q))
    if (hit) focusOn(hit.id)
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, select')) return
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault()
      undo()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      save()
    } else if (selectedAnchor && e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (d) move(selectedAnchor.id, { x: selectedAnchor.at.x + d[0], y: selectedAnchor.at.y + d[1] })
    } else if (e.key === 'Escape') {
      selected = null
    }
  }

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (changed.length) e.preventDefault()
  }

  onMount(() => {
    load(mapId)
  })

  const tokenMarkup = (a: Anchor, type: 'Army' | 'Fleet', isSelected: boolean, out: boolean): string =>
    unitToken(a.at.x, a.at.y, type, out ? '#dc2626' : isSelected ? '#2563eb' : '#57534e', DEFAULT_UNIT_STYLE, isSelected ? 1 : 0.85)
</script>

<svelte:window on:keydown={onKey} on:beforeunload={onBeforeUnload} />

<div class="editor">
  <header>
    <div class="maps" role="tablist">
      {#each MAP_IDS as id (id)}
        <button role="tab" aria-selected={id === mapId} class:on={id === mapId} on:click={() => id !== mapId && switchMap(id)}>
          {maps[id].name}
        </button>
      {/each}
    </div>
    <form on:submit|preventDefault={onSearch}>
      <input type="search" placeholder="Find province" bind:value={query} />
    </form>
    <label><input type="checkbox" bind:checked={fleetsOnCoasts} /> Fleets on coasts</label>
    <label><input type="checkbox" bind:checked={showIds} /> Ids</label>
    <span class="spacer"></span>
    {#if status}<span class="status">{status}</span>{/if}
    <button on:click={undo} disabled={!undoStack.length} title="Ctrl+Z">Undo</button>
    <button on:click={discard} disabled={!changed.length}>Discard</button>
    <button class="primary" on:click={save} disabled={!changed.length || saving} title="Ctrl+S">
      Save{changed.length ? ` ${changed.length}` : ''}
    </button>
  </header>

  <div class="board">
    {#if !renderer || !staticLayers || !board}
      <div class="msg">Loading…</div>
    {:else}
      <svg
        bind:this={svg}
        viewBox="{view.minX} {view.minY} {view.width} {view.height}"
        preserveAspectRatio="xMidYMid meet"
        fill={staticLayers.rootFill ?? undefined}
        class:panning={pan}
        on:pointerdown={onBoardDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
        on:pointercancel={onPointerUp}
        on:wheel={onWheel}
        role="application"
      >
        {#if rasters}
          <image href={rasters.below.url} x={board.minX} y={board.minY} width={board.width} height={board.height} preserveAspectRatio="none" />
        {:else}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html staticLayers.defs + staticLayers.below}
        {/if}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <g pointer-events="none">{@html (rasters ? staticLayers.defs : '') + staticLayers.labels}</g>
        {#if rasters}
          <image href={rasters.above.url} x={board.minX} y={board.minY} width={board.width} height={board.height} preserveAspectRatio="none" pointer-events="none" />
        {/if}

        {#if focusAnchor?.regionD}
          <path d={focusAnchor.regionD} class="region" stroke-width={3 / Math.sqrt(k)} pointer-events="none" />
        {/if}

        {#each changed as a (a.id)}
          <line x1={a.saved.x} y1={a.saved.y} x2={a.at.x} y2={a.at.y} class="trail" stroke-width={1.5 / Math.sqrt(k)} />
          <circle cx={a.saved.x} cy={a.saved.y} r={3 / Math.sqrt(k)} class="ghost" />
        {/each}

        {#each anchors as a (a.id)}
          {@const type = unitType(a.id)}
          {@const out = !inside(a)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g
            class="anchor"
            class:coast={isCoast(a.id)}
            on:pointerdown={(e) => onAnchorDown(e, a)}
            on:pointerenter={() => (hovered = a.id)}
            on:pointerleave={() => hovered === a.id && (hovered = null)}
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html tokenMarkup(a, type, a.id === selected, out)}
            {#if isCoast(a.id)}
              <circle cx={a.at.x} cy={a.at.y} r="14" class="coast-ring" />
            {/if}
            {#if showIds || a.id === hovered || a.id === selected}
              <text x={a.at.x} y={a.at.y - 16} class="tag" font-size={Math.max(7, 12 / Math.sqrt(k))}>{a.id}</text>
            {/if}
          </g>
        {/each}
      </svg>
    {/if}

    {#if selectedAnchor}
      <aside>
        <div class="name">{regionName(selectedAnchor.id)}</div>
        <div class="id">{selectedAnchor.id}</div>
        <div class="coords">
          <label>x <input type="number" step="0.1" value={selectedAnchor.at.x} on:change={(e) => move(selectedAnchor.id, { x: +e.currentTarget.value, y: selectedAnchor.at.y })} /></label>
          <label>y <input type="number" step="0.1" value={selectedAnchor.at.y} on:change={(e) => move(selectedAnchor.id, { x: selectedAnchor.at.x, y: +e.currentTarget.value })} /></label>
        </div>
        {#if !inside(selectedAnchor)}<div class="warn">Outside its region</div>{/if}
        <button on:click={() => revert(selectedAnchor.id)} disabled={selectedAnchor.at.x === selectedAnchor.saved.x && selectedAnchor.at.y === selectedAnchor.saved.y}>Revert</button>
      </aside>
    {/if}
  </div>
</div>

<style>
  .editor {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
    flex-wrap: wrap;
    font-size: 14px;
  }
  .maps {
    display: flex;
    background: var(--bg-fill);
    border-radius: var(--radius-sm);
    padding: 2px;
  }
  .maps button {
    border: 0;
    background: transparent;
    padding: 5px 12px;
    border-radius: 5px;
    color: var(--text-secondary);
  }
  .maps button.on {
    background: var(--bg-card);
    color: var(--text);
    box-shadow: var(--shadow-sm);
    font-weight: 600;
  }
  header input[type='search'] {
    width: 160px;
    padding: 5px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    color: var(--text);
  }
  header label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-secondary);
  }
  .spacer {
    flex: 1;
  }
  .status {
    color: var(--text-secondary);
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    padding: 5px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text);
    cursor: pointer;
    font: inherit;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-inverse);
  }
  .board {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .board svg {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    user-select: none;
    cursor: grab;
  }
  .board svg.panning {
    cursor: grabbing;
  }
  .msg {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-secondary);
  }
  .anchor {
    cursor: move;
  }
  .coast-ring {
    fill: none;
    stroke: #2563eb;
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }
  .region {
    fill: rgba(37, 99, 235, 0.12);
    stroke: #2563eb;
    stroke-linejoin: round;
  }
  .trail {
    stroke: #2563eb;
    stroke-dasharray: 4 3;
    pointer-events: none;
  }
  .ghost {
    fill: #2563eb;
    opacity: 0.6;
    pointer-events: none;
  }
  .tag {
    text-anchor: middle;
    font-family: var(--mono);
    font-weight: 600;
    fill: #111;
    paint-order: stroke;
    stroke: #fff;
    stroke-width: 3;
    pointer-events: none;
  }
  aside {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    min-width: 180px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    font-size: 14px;
  }
  aside .name {
    font-weight: 600;
  }
  aside .id {
    font-family: var(--mono);
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .coords {
    display: flex;
    gap: 8px;
  }
  .coords label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-secondary);
  }
  .coords input {
    width: 72px;
    padding: 3px 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    color: var(--text);
  }
  .warn {
    color: var(--red);
    font-size: 13px;
  }
</style>
