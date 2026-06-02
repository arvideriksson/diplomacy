<script lang="ts">
  import type { Unit } from '../lib/game'
  import { submitOrders, fetchMyOrders } from '../lib/game'
  import type { MapDefinition } from '../lib/mapDefinition'
  import DiplomacyMap from './DiplomacyMap.svelte'
  import RetreatPanel from './RetreatPanel.svelte'
  import BuildPanel from './BuildPanel.svelte'
  import { toDsvgId, toGameId } from '../lib/map/idMap'
  import type { AnyOrder, Order, OrderType } from '../lib/orders/types'
  import {
    nextStep,
    finalize,
    toOrderStates,
    applicableOrderTypes,
    type Draft,
    type Step,
    type WizardContext,
  } from '../lib/orders/wizard'
  import { formatOrder, formatAnyOrder } from '../lib/orders/notation'

  export let mapDef: MapDefinition
  export let gameId: string = ''
  export let units: Unit[] = []
  export let ownership: Record<string, string> = {}
  /** The viewer's nation; order entry is limited to their units. Empty = view only. */
  export let nation: string = ''
  /** Current game phase; movement supports order entry today. */
  export let phase: string = 'movement'
  /** Season + year — together with phase they identify the round (for clearing orders). */
  export let season: string = 'Spring'
  export let year: number = 1901
  /** Whether this nation has already marked ready for the current round. */
  export let ready: boolean = false
  /** Dislodged units awaiting retreat (from the snapshot; retreat phase only). */
  export let dislodged: Array<{ unit: Unit; attackedFrom: string }> = []
  /** Standoff squares a retreat may not enter (retreat phase only). */
  export let contested: string[] = []
  /** Supply-center ownership (from the snapshot; build phase only). */
  export let supplyCenters: Record<string, string> = {}
  /** Sandbox/god mode: control every power's units, not just `nation`. */
  export let controlAll: boolean = false
  /** When set (sandbox), the footer resolves locally via this instead of the RPC. */
  export let onResolve: ((orders: AnyOrder[]) => void) | null = null
  /** Sandbox: orders already entered for this phase, to preset the panel. */
  export let initialOrders: AnyOrder[] = []
  /** Sandbox: notified when the user edits orders (for storing/forking the timeline). */
  export let onOrdersChange: ((orders: AnyOrder[]) => void) | null = null
  /** Disambiguates the round for re-seeding (sandbox passes its cursor). */
  export let seedKey: string = ''
  /** Sandbox phase navigation (renders ←/→ around the phase label when provided). */
  export let onPhaseBack: (() => void) | null = null
  export let onPhaseForward: (() => void) | null = null
  export let canPhaseBack: boolean = false
  export let canPhaseForward: boolean = false
  /** Read-only history view of a past phase: no order entry, just the resolved orders. */
  export let readOnly: boolean = false
  /** The resolved orders to display in read-only history mode. */
  export let historyOrders: AnyOrder[] = []

  let orders: Order[] = []
  let draft: Draft | null = null
  let currentStep: Step | null = null
  let saving = false
  let saveError = ''

  // Movement is the only phase the wizard builds orders for today.
  $: canOrder = !readOnly && (controlAll || Boolean(nation)) && phase === 'movement'

  // Movement orders to draw as arrows: live entry, or the resolved history orders.
  const MOVE_TYPES = ['Hold', 'Move', 'Support', 'Convoy']

  // Reset order entry whenever the ROUND changes — identified by (year, season,
  // phase), which changes on every phase transition even when no unit moved (e.g.
  // all moves bounce, Spring→Fall). Keying only on phase would leave last turn's
  // arrows on a no-move resolution. Live mode then reloads this nation's saved
  // orders; sandbox starts fresh.
  let roundKey = ''
  $: {
    const key = `${gameId}|${seedKey}|${year}|${season}|${phase}`
    if (key !== roundKey) {
      roundKey = key
      draft = null
      currentStep = null
      if (onResolve) orders = (initialOrders as Order[]) ?? [] // sandbox: preset
      else if (gameId && nation && phase === 'movement') loadOrders() // live: reload saved
      else orders = []
    }
  }

  // Notify the parent of a user edit (sandbox stores it / forks the timeline).
  const notifyOrders = () => onOrdersChange?.(orders)

  async function loadOrders() {
    try {
      orders = (await fetchMyOrders(gameId)) as Order[]
    } catch {
      orders = []
    }
  }

  async function save(markReady: boolean) {
    if (!gameId || !nation) return
    saving = true
    saveError = ''
    try {
      await submitOrders(gameId, orders, markReady)
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  async function toggleReady() {
    if (!gameId) return
    saving = true
    saveError = ''
    try {
      // Submit current orders and flip ready so edits and readiness stay consistent.
      await submitOrders(gameId, orders, !ready)
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  const matchesNation = (u: Unit): boolean =>
    !nation || u.nation.toLowerCase() === nation.toLowerCase()

  $: ownUnits = controlAll ? units : units.filter(matchesNation)

  function context(d: Draft): WizardContext | null {
    const unit = units.find((u) => u.territory === d.source && (u.coast ?? '') === (d.sourceCoast ?? ''))
    return unit ? { map: mapDef, unit, units } : null
  }

  // Advance the wizard after any draft change; auto-commit when complete.
  function recompute() {
    if (!draft) {
      currentStep = null
      return
    }
    const ctx = context(draft)
    if (!ctx) {
      draft = null
      currentStep = null
      return
    }
    const step = nextStep(draft, ctx)
    if (step.kind === 'done') {
      commit(ctx)
    } else {
      currentStep = step
    }
  }

  function commit(ctx: WizardContext) {
    if (!draft) return
    const order = finalize(draft, ctx)
    orders = [...orders.filter((o) => o.source !== order.source), order]
    draft = null
    currentStep = null
    notifyOrders()
  }

  // Clicking a unit starts a Move draft right away (highlights destinations).
  function startDraft(unit: Unit) {
    draft = { source: unit.territory, sourceCoast: unit.coast, type: 'Move' }
    recompute()
  }

  // Switch the draft's order type, resetting any destination/aux already chosen.
  function setType(type: OrderType) {
    if (!draft) return
    draft = { source: draft.source, sourceCoast: draft.sourceCoast, type }
    recompute()
  }

  // Keyboard shortcuts while a draft is active: H hold, M move, S support, C convoy.
  function onKeydown(e: KeyboardEvent) {
    if (!draft || !canOrder) return
    if (e.key === 'Escape') {
      cancel()
      return
    }
    const byKey: Record<string, OrderType> = { h: 'Hold', m: 'Move', s: 'Support', c: 'Convoy' }
    const t = byKey[e.key.toLowerCase()]
    if (t && (t === 'Hold' || draftTypes.includes(t))) {
      e.preventDefault()
      setType(t)
    }
  }

  function applyProvince(dsvgId: string) {
    if (!draft || currentStep?.kind !== 'province') return
    const choice = currentStep.choices.find((c) => toDsvgId(c.id, c.coast) === dsvgId)
    if (!choice) return
    // A target choice may carry a coast (multi-coast destinations), completing the move.
    if (currentStep.field === 'target') draft = { ...draft, target: choice.id, targetCoast: choice.coast }
    else if (currentStep.field === 'coast') draft = { ...draft, targetCoast: choice.coast }
    else if (currentStep.field === 'aux') draft = { ...draft, aux: choice.id }
    recompute()
  }

  function handleProvinceClick(dsvgId: string) {
    const gid = toGameId(dsvgId)
    if (!draft) {
      const unit = ownUnits.find((u) => u.territory === gid)
      if (unit) startDraft(unit)
      return
    }
    // clicking the ordered unit's own province holds it
    if (gid === draft.source) {
      setType('Hold')
      return
    }
    applyProvince(dsvgId)
  }

  function cancel() {
    draft = null
    currentStep = null
  }

  function deleteOrder(source: string) {
    orders = orders.filter((o) => o.source !== source)
    notifyOrders()
  }

  // ── map inputs derived from wizard state ──────────────────────────────
  $: highlighted =
    currentStep?.kind === 'province'
      ? currentStep.choices.map((c) => toDsvgId(c.id, c.coast))
      : []

  // Order types available for the unit currently being drafted.
  $: draftCtx = draft ? context(draft) : null
  $: draftTypes = draftCtx ? applicableOrderTypes(draftCtx) : []

  // Clickable regions: all own units when idle; during a draft, the step's choices
  // plus the unit's own province (clicking it holds). Units are targeted at the
  // PROVINCE level (coast collapsed) so hovering a fleet on a multi-coast province
  // highlights the whole province, not just its coast.
  $: selectable = !draft
    ? ownUnits.map((u) => toDsvgId(u.territory))
    : [...highlighted, toDsvgId(draft.source)]

  $: renderOrders = readOnly
    ? toOrderStates(historyOrders.filter((o) => MOVE_TYPES.includes(o.type)) as Order[])
    : toOrderStates(orders)

  const provinceName = (id: string): string => mapDef.territories[id]?.name ?? id
  $: draftUnit = draft ? units.find((u) => u.territory === draft!.source) : undefined
  $: draftLabel = draftUnit
    ? `${draftUnit.type === 'fleet' ? 'Fleet' : 'Army'} ${provinceName(draft!.source)}`
    : ''
</script>

<svelte:window on:keydown={onKeydown} />

<div class="game">
  <div class="map-area">
    <DiplomacyMap
      fill
      {mapDef}
      {units}
      {ownership}
      orders={renderOrders}
      {highlighted}
      {selectable}
      onProvinceClick={canOrder ? handleProvinceClick : null}
    />
  </div>

  <aside class="sidebar">
    <div class="side-head">
      {#if onPhaseBack}
        <!-- Sandbox: step back/forward through the phase chain. -->
        <button class="nav" on:click={onPhaseBack} disabled={!canPhaseBack} title="Previous phase">←</button>
        <span class="phase-label">{season} {year}</span>
        <button class="nav" on:click={onPhaseForward} disabled={!canPhaseForward} title="Next phase">→</button>
      {:else}
        <span class="phase-label">{season} {year}</span>
      {/if}
      <span class="phase-pill">{phase}</span>
    </div>
    {#if $$slots.toolbar}
      <div class="side-toolbar"><slot name="toolbar" /></div>
    {/if}

    <div class="side-body">
      {#if readOnly}
        <div class="panel">
          {#if historyOrders.length}
            <ul class="orders">
              {#each historyOrders as o, i (i)}
                <li><span>{formatAnyOrder(mapDef, units, dislodged, o)}</span></li>
              {/each}
            </ul>
          {:else}
            <p class="prompt">No orders were submitted this phase.</p>
          {/if}
        </div>
      {:else if (nation || controlAll) && phase === 'retreat'}
        <RetreatPanel map={mapDef} {nation} {units} {dislodged} {contested} {gameId} {ready} {controlAll} {onResolve} {initialOrders} {onOrdersChange} />
      {:else if (nation || controlAll) && phase === 'build'}
        <BuildPanel map={mapDef} {nation} {units} {supplyCenters} {gameId} {ready} {controlAll} {onResolve} {initialOrders} {onOrdersChange} />
      {:else if nation || controlAll}
        <div class="panel">
          {#if draft}
        <div class="panel-head">
          <strong>{draftLabel}</strong>
          <button class="link" on:click={cancel}>Cancel</button>
        </div>
        <div class="type-row">
          {#each draftTypes as t}
            <button class="type" class:active={draft.type === t} on:click={() => setType(t)}>
              {t}<kbd>{t[0]}</kbd>
            </button>
          {/each}
        </div>
        {#if currentStep?.kind === 'province'}
          <p class="prompt">{currentStep.prompt} — click a highlighted region (or this unit to hold)</p>
          <div class="choices">
            {#each currentStep.choices as c}
              <button on:click={() => applyProvince(toDsvgId(c.id, c.coast))}>{c.label}</button>
            {/each}
          </div>
        {/if}
      {:else if canOrder}
        <p class="prompt">
          Click a unit — it defaults to <strong>Move</strong>. Then <kbd>S</kbd> support,
          <kbd>C</kbd> convoy, <kbd>H</kbd> hold (or click the unit again to hold).
        </p>
      {:else}
        <p class="prompt">Order entry for the {phase} phase isn’t available yet.</p>
      {/if}

      {#if orders.length}
        <ul class="orders">
          {#each orders as o (o.source)}
            <li>
              <span>{formatOrder(mapDef, units, o)}</span>
              {#if canOrder}
                <button class="link" on:click={() => deleteOrder(o.source)}>✕</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if canOrder}
        <div class="actions">
          {#if onResolve}
            <button class="ready on" on:click={() => onResolve?.(orders)}>Resolve turn</button>
          {:else}
            <button on:click={() => save(false)} disabled={saving}>Save</button>
            <button class="ready" class:on={ready} on:click={toggleReady} disabled={saving}>
              {ready ? 'Ready ✓ — unready' : 'Submit & ready'}
            </button>
            {#if saving}<span class="status">Saving…</span>{/if}
            {#if saveError}<span class="status error">{saveError}</span>{/if}
          {/if}
        </div>
      {/if}
        </div>
      {/if}

      <slot name="results" />
    </div>
  </aside>
</div>

<style>
  /* Immersive in-game shell: map fills the left, a docked sidebar on the right. */
  .game {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .map-area {
    flex: 1;
    min-width: 0;
    position: relative;
  }
  .sidebar {
    flex: none;
    width: 340px;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border, #e5e7eb);
    background: var(--bg-card, #fff);
    overflow-y: auto;
  }
  .side-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border, #eee);
  }
  .side-head .nav {
    border: 1px solid var(--border-strong, #cbd5e1);
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    border-radius: 6px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    flex: none;
  }
  .side-head .nav:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .side-head .phase-label {
    font-weight: 700;
    letter-spacing: -0.2px;
  }
  .side-head .phase-pill {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent-subtle, #e0edff);
    color: var(--accent, #3b82f6);
    flex: none;
    margin-left: auto;
  }
  .side-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border, #eee);
  }
  .side-body {
    flex: 1;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .panel {
    font-size: 14px;
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .prompt {
    margin: 0 0 8px;
    color: var(--text-secondary, #555);
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .choices button {
    padding: 5px 10px;
    border: 1px solid var(--border-strong, #bbb);
    border-radius: 6px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
    font-size: 13px;
  }
  .choices button:hover {
    border-color: var(--accent, #3b82f6);
  }
  .type-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .type-row .type {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid var(--border-strong, #bbb);
    border-radius: 6px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
    font-size: 13px;
  }
  .type-row .type.active {
    background: var(--accent, #3b82f6);
    color: #fff;
    border-color: var(--accent, #3b82f6);
  }
  kbd {
    font: 11px/1 ui-monospace, monospace;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.2));
    background: var(--bg-hover, rgba(0, 0, 0, 0.06));
    color: var(--text-secondary, #5c5c5c);
  }
  /* On the selected (accent) button the hint needs to read against the blue fill. */
  .type-row .type.active kbd {
    border-color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.25);
    color: #fff;
  }
  .link {
    background: none;
    border: none;
    color: var(--accent, #3b82f6);
    cursor: pointer;
    font-size: 13px;
  }
  .orders {
    list-style: none;
    margin: 12px 0 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--border, #eee);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .orders li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border, #eee);
  }
  .actions button {
    padding: 6px 12px;
    border: 1px solid var(--border-strong, #bbb);
    border-radius: 6px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
    font-size: 13px;
  }
  .actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .actions .ready.on {
    background: var(--accent, #3b82f6);
    color: #fff;
    border-color: var(--accent, #3b82f6);
  }
  .status {
    font-size: 12px;
    color: var(--text-secondary, #777);
  }
  .status.error {
    color: #dc2626;
  }
</style>
