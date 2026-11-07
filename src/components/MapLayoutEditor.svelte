<script lang="ts">
  // Dev-only layout editor: where units stand on each province and named coast, where supply
  // centers sit, and where names, coast marks and notes go (and at what angle). Every board
  // stores these the same way (unit-positions / supply-centers points, placed label groups in
  // province-names); saves go through the Vite dev server (scripts/mapLayoutPlugin.ts).
  import { onDestroy, onMount, tick } from 'svelte'
  import { immersive } from '../lib/layout'
  import { maps } from '../lib/maps'
  import { DiplicityMap, type StaticLayers } from '../lib/map/mapRenderer'
  import { rasterizeSvg, type Raster } from '../lib/map/rasterize'
  import { toRenderState } from '../lib/map/renderState'
  import { toGameId } from '../lib/map/idMap'
  import { isCoast } from '../lib/map/coasts'
  import { unitToken } from '../lib/map/render/units'
  import { bullseye } from '../lib/map/render/atmosphere'
  import { DEFAULT_UNIT_STYLE } from '../lib/map/unitStyles'
  import type { Point, ViewBox } from '../lib/map/dsvgParser'

  type Kind = 'unit' | 'center' | 'label'
  type Item = {
    key: string
    kind: Kind
    id: string
    at: Point
    saved: Point
    angle: number
    savedAngle: number
    region?: Path2D
    regionD?: string
  }

  const MAP_IDS = ['classical', '1900', 'era']
  const KINDS: { kind: Kind; label: string }[] = [
    { kind: 'unit', label: 'Units' },
    { kind: 'center', label: 'Centers' },
    { kind: 'label', label: 'Labels' },
  ]
  const RASTER_PIXELS = 16_000_000
  const LABEL_ID = /^(name|coast|note):/
  const TRANSFORM = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)(?:\s*rotate\(\s*([-\d.e]+)\s*\))?/

  immersive.set(true)
  onDestroy(() => immersive.set(false))

  let mapId = new URLSearchParams(location.search).get('map') ?? 'classical'
  if (!MAP_IDS.includes(mapId)) mapId = 'classical'

  let renderer: DiplicityMap | null = null
  let staticLayers: StaticLayers | null = null
  let rasters: { below: Raster; above: Raster } | null = null
  let board: ViewBox | null = null
  let view: ViewBox = { minX: 0, minY: 0, width: 1, height: 1 }
  let items: Item[] = []
  let selected: string | null = null
  let hovered: string | null = null
  let show: Record<Kind, boolean> = { unit: true, center: true, label: true }
  let fleetsOnCoasts = false
  let showIds = false
  let query = ''
  let status = ''
  let saving = false
  let undoStack: { key: string; at: Point; angle: number }[] = []
  let svg: SVGSVGElement
  let labelLayer: SVGGElement
  let loadToken = 0

  const ctx = document.createElement('canvas').getContext('2d')!

  $: mapDef = maps[mapId]
  $: changed = items.filter((i) => i.at.x !== i.saved.x || i.at.y !== i.saved.y || i.angle !== i.savedAngle)
  $: selectedItem = items.find((i) => i.key === selected) ?? null
  $: focusItem = items.find((i) => i.key === (hovered ?? selected)) ?? null
  $: k = board ? board.width / view.width : 1
  $: visible = items.filter((i) => show[i.kind])

  const inside = (i: Item, p: Point = i.at): boolean => !i.region || ctx.isPointInPath(i.region, p.x, p.y, 'evenodd')
  const round = (n: number) => Math.round(n * 10) / 10

  function unitType(id: string): 'Army' | 'Fleet' {
    if (isCoast(id)) return 'Fleet'
    const type = mapDef.territories[toGameId(id)]?.type
    return type === 'sea' || (type === 'coast' && fleetsOnCoasts) ? 'Fleet' : 'Army'
  }

  /** The province or coast a unit anchor, center or label belongs to. */
  const targetOf = (i: Pick<Item, 'kind' | 'id'>): string => (i.kind === 'label' ? i.id.replace(LABEL_ID, '').replace(/~\d+$/, '') : i.id)

  function regionName(i: Pick<Item, 'kind' | 'id'>): string {
    if (i.kind === 'label' && i.id.startsWith('note:')) return `Note: ${i.id.slice(5)}`
    const id = targetOf(i)
    const t = mapDef.territories[toGameId(id)]
    if (!t) return id
    const coast = isCoast(id) ? t.coasts?.[id.split('/')[1]]?.name ?? id.split('/')[1].toUpperCase() : ''
    const name = coast ? `${t.name} (${coast})` : t.name
    return i.kind === 'center' ? `${name} supply center` : i.kind === 'label' ? `${name} ${i.id.startsWith('coast:') ? 'coast mark' : 'label'}` : name
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
    // Supply centers are drawn live by the editor (draggable), not baked into the raster.
    const layers = map.renderStatic(toRenderState({ mapDef: maps[id] }), { supplyCenters: false })
    const regions = new Map([...map.provincePaths, ...map.namedCoastPaths])
    const item = (kind: Kind, iid: string, p: Point, angle = 0): Item => {
      const d = regions.get(targetOf({ kind, id: iid }))
      return { key: `${kind}:${iid}`, kind, id: iid, at: { ...p }, saved: { ...p }, angle, savedAngle: angle, region: d ? new Path2D(d) : undefined, regionD: d }
    }
    const units = [...map.unitPositions].map(([uid, p]) => item('unit', uid, p))
    // Coasts last, so they sit above (and are grabbable over) their province's own anchor.
    units.sort((a, b) => Number(isCoast(a.id)) - Number(isCoast(b.id)) || a.id.localeCompare(b.id))
    const centers = [...map.supplyCenters].map(([cid, p]) => item('center', cid, p))
    renderer = map
    staticLayers = layers
    board = map.viewBox
    view = { ...map.viewBox }
    // Labels are read back from the live label layer once it is in the DOM.
    items = [...centers, ...units]
    await tick()
    const labels: Item[] = []
    for (const el of Array.from(labelLayer?.querySelectorAll<SVGGElement>('g[id]') ?? [])) {
      const m = LABEL_ID.test(el.id) && el.getAttribute('transform')?.match(TRANSFORM)
      if (!m) continue
      labels.push(item('label', el.id, { x: +m[1], y: +m[2] }, +(m[3] ?? 0)))
    }
    items = [...labels, ...centers, ...units]
    const vb = map.viewBox
    const scale = Math.min(3, Math.sqrt(RASTER_PIXELS / (vb.width * vb.height)))
    const px = { w: vb.width * scale, h: vb.height * scale }
    const [below, above] = await Promise.all([
      rasterizeSvg(layers.below, layers.defs, layers.rootFill, vb, px),
      rasterizeSvg(layers.above, layers.defs, layers.rootFill, vb, px),
    ])
    if (token !== loadToken) return
    rasters = { below, above }
    // The label layer was just re-created from the board markup: re-apply unsaved moves.
    await tick()
    for (const i of changed) labelEl(i)?.setAttribute('transform', transformOf(i))
  }

  function switchMap(id: string) {
    if (changed.length && !confirm(`Discard ${changed.length} unsaved change(s)?`)) return
    mapId = id
    const url = new URL(location.href)
    url.searchParams.set('map', id)
    history.replaceState(history.state, '', url)
    load(id)
  }

  // A label's group in the live label layer, looked up by id (the layer's markup is re-created
  // when the board's rasters arrive, so element references go stale).
  const labelEl = (i: Item): SVGGElement | null => (i.kind === 'label' ? labelLayer?.querySelector<SVGGElement>(`g[id="${CSS.escape(i.id)}"]`) ?? null : null)
  const transformOf = (i: Item) => `translate(${i.at.x} ${i.at.y})${i.angle ? ` rotate(${i.angle})` : ''}`

  /** Apply a position/angle to an item, and to its label group in the DOM. */
  function place(i: Item, at: Point, angle = i.angle) {
    i.at = { x: round(at.x), y: round(at.y) }
    i.angle = round(angle)
    labelEl(i)?.setAttribute('transform', transformOf(i))
  }

  function move(key: string, at: Point, angle?: number, record = true) {
    const i = items.find((x) => x.key === key)
    if (!i) return
    if (record) undoStack = [...undoStack, { key, at: { ...i.at }, angle: i.angle }]
    place(i, at, angle ?? i.angle)
    items = items
  }

  function undo() {
    const last = undoStack.at(-1)
    if (!last) return
    undoStack = undoStack.slice(0, -1)
    move(last.key, last.at, last.angle, false)
    selected = last.key
  }

  function revert(key: string) {
    const i = items.find((x) => x.key === key)
    if (i) move(key, i.saved, i.savedAngle)
  }

  function discard() {
    for (const i of items) place(i, i.saved, i.savedAngle)
    items = items
    undoStack = []
  }

  async function save() {
    if (!changed.length || saving) return
    saving = true
    status = ''
    try {
      const pick = (kind: Kind) => changed.filter((i) => i.kind === kind)
      const body = {
        units: Object.fromEntries(pick('unit').map((i) => [i.id, [i.at.x, i.at.y]])),
        centers: Object.fromEntries(pick('center').map((i) => [i.id, [i.at.x, i.at.y]])),
        labels: Object.fromEntries(pick('label').map((i) => [i.id, { at: [i.at.x, i.at.y], angle: i.angle }])),
      }
      const res = await fetch(`/__map-layout/${mapId}`, { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
      const n = changed.length
      for (const i of items) {
        i.saved = { ...i.at }
        i.savedAngle = i.angle
      }
      items = items
      undoStack = []
      status = `Saved ${n}`
    } catch (e) {
      status = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  // ── pointer: drag items, pan the board, wheel zoom ───────────────────
  let drag: { key: string; grab: Point; start: Point } | null = null
  let pan: { inverse: DOMMatrix; from: Point; view: ViewBox } | null = null

  const toBoard = (e: { clientX: number; clientY: number }, m = svg.getScreenCTM()?.inverse()): Point => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m)
    return { x: p.x, y: p.y }
  }

  function startDrag(e: PointerEvent, i: Item) {
    e.stopPropagation()
    selected = i.key
    const p = toBoard(e)
    drag = { key: i.key, grab: { x: p.x - i.at.x, y: p.y - i.at.y }, start: { ...i.at } }
    svg.setPointerCapture(e.pointerId)
  }

  function onItemDown(e: PointerEvent, i: Item) {
    if (e.button === 0) startDrag(e, i)
  }

  function onBoardDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return
    // A press on a label's box grabs the label.
    const group = e.button === 0 && show.label ? (e.target as Element).closest?.('g[id]') : null
    const label = group && items.find((i) => i.kind === 'label' && i.id === group.id)
    if (label) return startDrag(e, label)
    const inverse = svg.getScreenCTM()?.inverse()
    if (!inverse) return
    pan = { inverse, from: toBoard(e, inverse), view: { ...view } }
    svg.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (drag) {
      const p = toBoard(e)
      const i = items.find((x) => x.key === drag!.key)
      if (i) {
        place(i, { x: p.x - drag.grab.x, y: p.y - drag.grab.y })
        items = items
      }
    } else if (pan) {
      const p = toBoard(e, pan.inverse)
      view = { ...view, minX: pan.view.minX - (p.x - pan.from.x), minY: pan.view.minY - (p.y - pan.from.y) }
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (drag) {
      const i = items.find((x) => x.key === drag!.key)
      if (i && (i.at.x !== drag.start.x || i.at.y !== drag.start.y)) undoStack = [...undoStack, { key: i.key, at: drag.start, angle: i.angle }]
    } else if (pan) {
      // A click (no pan) on the board selects the unit anchor of the province under it.
      const p = toBoard(e, pan.inverse)
      if (Math.hypot(p.x - pan.from.x, p.y - pan.from.y) < 2 / k) {
        const hit = [...visible].reverse().find((i) => i.kind === 'unit' && i.region && inside(i, p))
        selected = hit?.key ?? null
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

  function focusOn(key: string) {
    const i = items.find((x) => x.key === key)
    if (!i || !board) return
    selected = key
    const width = Math.min(view.width, board.width / 4)
    const height = (view.height / view.width) * width
    view = { minX: i.at.x - width / 2, minY: i.at.y - height / 2, width, height }
  }

  function onSearch() {
    const q = query.trim().toLowerCase()
    if (!q) return
    const pool = visible.length ? visible : items
    const hit =
      pool.find((i) => i.id === q || targetOf(i) === q) ??
      pool.find((i) => regionName(i).toLowerCase() === q) ??
      pool.find((i) => targetOf(i).startsWith(q) || regionName(i).toLowerCase().startsWith(q))
    if (hit) focusOn(hit.key)
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, select')) return
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault()
      undo()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      save()
    } else if (selectedItem && e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (d) move(selectedItem.key, { x: selectedItem.at.x + d[0], y: selectedItem.at.y + d[1] })
    } else if (selectedItem?.kind === 'label' && (e.key === '[' || e.key === ']')) {
      e.preventDefault()
      const step = (e.shiftKey ? 5 : 1) * (e.key === '[' ? -1 : 1)
      move(selectedItem.key, selectedItem.at, selectedItem.angle + step)
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

  /** A label's box in its own (rotated) frame, for the selection outline. */
  function labelBox(i: Item): DOMRect | null {
    try {
      return labelEl(i)?.getBBox() ?? null
    } catch {
      return null
    }
  }

  const tokenMarkup = (i: Item, type: 'Army' | 'Fleet', isSelected: boolean, out: boolean): string =>
    unitToken(i.at.x, i.at.y, type, out ? '#dc2626' : isSelected ? '#2563eb' : '#57534e', DEFAULT_UNIT_STYLE, isSelected ? 1 : 0.85)
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
    {#each KINDS as { kind, label } (kind)}
      <label><input type="checkbox" bind:checked={show[kind]} /> {label}</label>
    {/each}
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
        <g bind:this={labelLayer} class="labels" class:editable={show.label}>{@html (rasters ? staticLayers.defs : '') + staticLayers.labels}</g>
        {#if rasters}
          <image href={rasters.above.url} x={board.minX} y={board.minY} width={board.width} height={board.height} preserveAspectRatio="none" pointer-events="none" />
        {/if}

        {#if focusItem?.regionD}
          <path d={focusItem.regionD} class="region" stroke-width={3 / Math.sqrt(k)} pointer-events="none" />
        {/if}

        {#each changed as i (i.key)}
          <line x1={i.saved.x} y1={i.saved.y} x2={i.at.x} y2={i.at.y} class="trail" stroke-width={1.5 / Math.sqrt(k)} />
          <circle cx={i.saved.x} cy={i.saved.y} r={3 / Math.sqrt(k)} class="ghost" />
        {/each}

        {#each items.filter((i) => i.kind === 'center') as i (i.key)}
          {@const out = !inside(i)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g
            class="item"
            class:hidden={!show.center}
            on:pointerdown={(e) => onItemDown(e, i)}
            on:pointerenter={() => (hovered = i.key)}
            on:pointerleave={() => hovered === i.key && (hovered = null)}
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html bullseye(i.at.x, i.at.y)}
            <circle cx={i.at.x} cy={i.at.y} r="11" class="hit" class:selected={i.key === selected} class:out />
          </g>
        {/each}

        {#if show.label}
          {#each items.filter((i) => i.kind === 'label' && (i.key === selected || i.key === hovered)) as i (i.key)}
            {@const b = labelBox(i)}
            {#if b}
              <rect
                x={b.x - 2}
                y={b.y - 2}
                width={b.width + 4}
                height={b.height + 4}
                transform="translate({i.at.x} {i.at.y}){i.angle ? ` rotate(${i.angle})` : ''}"
                class="label-box"
                class:selected={i.key === selected}
                stroke-width={1.5 / Math.sqrt(k)}
                pointer-events="none"
              />
            {/if}
          {/each}
        {/if}

        {#if show.unit}
          {#each items.filter((i) => i.kind === 'unit') as i (i.key)}
            {@const type = unitType(i.id)}
            {@const out = !inside(i)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <g
              class="item"
              on:pointerdown={(e) => onItemDown(e, i)}
              on:pointerenter={() => (hovered = i.key)}
              on:pointerleave={() => hovered === i.key && (hovered = null)}
            >
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html tokenMarkup(i, type, i.key === selected, out)}
              {#if isCoast(i.id)}
                <circle cx={i.at.x} cy={i.at.y} r="14" class="coast-ring" />
              {/if}
            </g>
          {/each}
        {/if}

        {#each visible.filter((i) => showIds || i.key === hovered || i.key === selected) as i (i.key)}
          <text x={i.at.x} y={i.at.y - 16} class="tag" font-size={Math.max(7, 12 / Math.sqrt(k))}>{i.id}</text>
        {/each}
      </svg>
    {/if}

    {#if selectedItem}
      <aside>
        <div class="name">{regionName(selectedItem)}</div>
        <div class="id">{selectedItem.id}</div>
        <div class="coords">
          <label>x <input type="number" step="0.1" value={selectedItem.at.x} on:change={(e) => move(selectedItem.key, { x: +e.currentTarget.value, y: selectedItem.at.y })} /></label>
          <label>y <input type="number" step="0.1" value={selectedItem.at.y} on:change={(e) => move(selectedItem.key, { x: selectedItem.at.x, y: +e.currentTarget.value })} /></label>
        </div>
        {#if selectedItem.kind === 'label'}
          <div class="coords">
            <label title="[ and ] turn it (Shift: 5°)">angle <input type="number" step="1" value={selectedItem.angle} on:change={(e) => move(selectedItem.key, selectedItem.at, +e.currentTarget.value)} /></label>
          </div>
        {:else if !inside(selectedItem)}
          <div class="warn">Outside its region</div>
        {/if}
        <button on:click={() => revert(selectedItem.key)} disabled={selectedItem.at.x === selectedItem.saved.x && selectedItem.at.y === selectedItem.saved.y && selectedItem.angle === selectedItem.savedAngle}>Revert</button>
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
  .item {
    cursor: move;
  }
  .item.hidden {
    display: none;
  }
  .hit {
    fill: transparent;
    stroke: none;
  }
  .hit.selected {
    stroke: #2563eb;
    stroke-width: 2;
  }
  .hit.out {
    stroke: #dc2626;
    stroke-width: 2;
  }
  .labels {
    pointer-events: none;
  }
  .labels.editable :global(g[id]) {
    pointer-events: bounding-box;
    cursor: move;
  }
  .label-box {
    fill: rgba(37, 99, 235, 0.08);
    stroke: #2563eb;
    stroke-dasharray: 3 2;
  }
  .label-box.selected {
    stroke-dasharray: none;
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
