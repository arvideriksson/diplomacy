<script lang="ts">
  import type { Unit } from '../lib/game'
  import { submitOrders, fetchMyOrders, saveDraftOrders } from '../lib/game'
  import { onDestroy } from 'svelte'
  import { errorMessage } from '../lib/errors'
  import { createDebouncer } from '../lib/debounce'
  import { isOrderPhase } from '../lib/phases'
  import { sameNation } from '../lib/powers'
  import type { MapDefinition } from '../lib/mapDefinition'
  import DiplomacyMap from './DiplomacyMap.svelte'
  import { toDsvgId, toGameId } from '../lib/map/idMap'
  import type { AnyOrder, BuildOrder, OrderType, RetreatOrder } from '../lib/orders/types'
  import { nextStep, finalize, applicableOrderTypes, type Draft, type Step, type WizardContext } from '../lib/orders/wizard'
  import { buildSituation } from '../lib/orders/adjustments'
  import {
    orderSource, withImplicitHolds, toRenderOrders, applyChoice, commitMove, ORDER_TYPE_KEYS, unorderedUnitIds,
    retreatChoices as retreatChoicesFor, retreatMapInputs,
    openBuildSpots, openRemovals, buildMapInputs, buildPrompt as buildPromptFor,
  } from '../lib/orders/board'
  import { isIdle } from '../lib/adjudicator/idle'
  import { formatAnyOrder } from '../lib/orders/notation'
  import SupplyCenterCard from './SupplyCenterCard.svelte'
  import LeftRail from './LeftRail.svelte'
  import DeadlineBanner from './DeadlineBanner.svelte'
  import BuildPicker from './BuildPicker.svelte'
  import OrderPanel from './OrderPanel.svelte'
  import SubmitControls from './SubmitControls.svelte'
  import PhaseHeader from './PhaseHeader.svelte'

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
  /** Leave the game and return to the menu (the global header is hidden in-game). */
  export let onExit: (() => void) | null = null
  /** Name shown at the top of the sidebar (game or sandbox name). */
  export let title: string = ''
  /** Width of the left rail. Wider in-game so chat can show a two-pane view. */
  export let leftWidth: string = '320px'
  /** ISO time the current phase auto-resolves. Null in lobby/history/sandbox. */
  export let deadline: string | null = null
  /** Powers yet to submit this round; once the deadline passes the phase waits on them. */
  export let awaiting: string[] = []
  /** When the phase stops waiting on `awaiting` past the deadline and resolves anyway. */
  export let graceEndsAt: string | null = null

  let orders: AnyOrder[] = []
  let spotlightNation = '' // nation whose SCs are spotlit (hovering the SC card)
  let draft: Draft | null = null // movement wizard
  let currentStep: Step | null = null
  let retreatSel: string | null = null // dislodged unit's province being routed (retreat)
  let buildSel: { province: string; nation: string } | null = null // center awaiting unit type (build)
  let saving = false
  let saveError = ''
  // Optimistic ready state: submit flips the UI immediately instead of waiting
  // for `ready` to round-trip back through the parent's realtime subscription. Cleared
  // once the prop catches up (or on round change).
  let readyOverride: boolean | null = null
  $: effectiveReady = readyOverride ?? ready
  $: if (readyOverride !== null && ready === readyOverride) readyOverride = null
  // Edits made after submitting (Phase 2) are ephemeral until Resubmit — flag them.
  let dirtySinceSubmit = false
  // Snapshot of the orders actually locked in on the server (the submitted set). Drives
  // the read-only "locked in" box; survives Phase 2 edits so it shows the committed
  // truth, not the live draft. Empty until this nation has readied.
  let submittedOrders: AnyOrder[] = []
  // True only after the user clicks Resubmit *in this view* (drives Submitted vs
  // Resubmitted). Reset on every load — on entry we can't tell submit from resubmit,
  // so an already-submitted game always reads as the calm "Submitted".
  let hasResubmitted = false
  // (The Submit/Submitted/Resubmit/Resubmitted labels derive from these in SubmitControls.)
  const DRAFT_DEBOUNCE_MS = 750
  // Live autosave of the unsubmitted draft (Phase 1, !ready); silent, no status UI.
  // A pending save is dropped (not flushed) on round change, submit and destroy.
  const draftSave = createDebouncer(() => saveDraftNow(), DRAFT_DEBOUNCE_MS)

  // Build type-picker popup: anchored at the clicked point within the map area.
  let mapArea: HTMLDivElement | undefined
  let lastPointer = { x: 0, y: 0 } // staged on pointerdown

  // Narrow screens: whether the left rail (title, Leave, chat / unit styles) drawer is open.
  let leftOpen = false
  let popupPos = { x: 0, y: 0 } // committed only when the selection changes (avoids flicker)
  let buildJustOpened = false

  // The left rail shows when there's a title, a Leave action or slotted rail content.
  $: hasRail = Boolean(title || onExit || $$slots.left)

  $: canAct = !readOnly && (controlAll || Boolean(nation)) && isOrderPhase(phase)

  // Reset order entry whenever the ROUND changes — identified by (year, season,
  // phase), which changes on every phase transition even when no unit moved (e.g.
  // all moves bounce, Spring→Fall). Live mode reloads this nation's saved orders;
  // sandbox starts from the preset for that phase.
  let roundKey = ''
  $: {
    const key = `${gameId}|${seedKey}|${year}|${season}|${phase}`
    if (key !== roundKey) {
      roundKey = key
      draft = null
      currentStep = null
      retreatSel = null
      buildSel = null
      dirtySinceSubmit = false
      readyOverride = null
      hasResubmitted = false
      submittedOrders = [] // loadOrders() repopulates it for an already-ready nation
      saveError = '' // clear any "catching up…" notice once the new round arrives
      draftSave.cancel()
      if (onResolve) orders = initialOrders ?? [] // sandbox: preset
      else if (gameId && nation && isOrderPhase(phase)) loadOrders() // live: reload saved
      else orders = []
    }
  }

  // Notify the parent of a user edit (sandbox stores it / forks the timeline) and,
  // in live play, persist the change: autosave the draft while unsubmitted, or just
  // flag unsaved edits once submitted (Phase 2 edits don't persist until Resubmit).
  const notifyOrders = () => {
    onOrdersChange?.(orders)
    if (onResolve) return // sandbox: no server persistence
    if (effectiveReady) dirtySinceSubmit = true
    else scheduleDraftSave()
  }

  // One row per round holds the orders whether drafted or submitted (readiness is the
  // `ready` prop, from games.ready) — so load it directly; no draft/submitted branching.
  async function loadOrders() {
    hasResubmitted = false
    try {
      orders = await fetchMyOrders(gameId, year, season, phase)
    } catch {
      orders = []
    }
    // If the nation is already ready, the loaded set IS the locked-in set; otherwise
    // it's an unsubmitted draft and nothing is locked in yet.
    submittedOrders = effectiveReady ? [...orders] : []
  }

  // Debounced autosave of the unsubmitted draft. No-op in sandbox, once ready, or
  // outside an order phase — those never write a draft.
  function scheduleDraftSave() {
    if (onResolve || effectiveReady || !gameId || !nation || !isOrderPhase(phase)) return
    draftSave.schedule()
  }

  async function saveDraftNow() {
    if (effectiveReady) return
    try {
      await saveDraftOrders(gameId, orders, { year, season, phase })
    } catch {
      // silent: a dropped autosave just retries on the next edit
    }
  }

  onDestroy(draftSave.cancel)

  // Submit (or resubmit): the orders row becomes the only persisted truth and the
  // draft is dropped server-side. Cancels any pending autosave and clears dirty.
  async function submit() {
    if (!gameId || !nation) return
    saving = true
    saveError = ''
    draftSave.cancel()
    const wasReady = effectiveReady // a commit while already submitted is a *re*submit
    const committed = withImplicitHolds(orders, phase, ownUnits) // un-ordered units become explicit Holds
    try {
      await submitOrders(gameId, committed, true, { year, season, phase })
      orders = committed // reflect the filled-in holds in the live, editable list too
      notifyOrders()
      dirtySinceSubmit = false
      readyOverride = true
      hasResubmitted = wasReady
      submittedOrders = [...committed] // the just-committed set is now locked in
    } catch (e) {
      const msg = errorMessage(e)
      // The round resolved between load and submit (instant early resolution + the brief
      // realtime-propagation lag). The incoming snapshot will advance us in a moment, so
      // show a soft "catching up" notice rather than a hard error; it clears on round change.
      saveError = msg.includes('Round has advanced') ? 'That round just resolved — catching up…' : msg
    } finally {
      saving = false
    }
  }

  // Revert ephemeral post-submit edits back to the submitted set.
  async function discardChanges() {
    await loadOrders()
    dirtySinceSubmit = false
  }

  const controllable = (n: string): boolean =>
    controlAll || !nation || sameNation(n, nation)

  $: ownUnits = units.filter((u) => controllable(u.nation))

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
    // A picked convoy route also orders the fleets this player controls to convoy it.
    orders = commitMove(orders, finalize(draft, ctx), draft.convoyPath, units, (n) => controlAll || n === nation)
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
    if (!canAct) return
    if (e.key === 'Escape') {
      cancel()
      return
    }
    if (!draft) return
    const t = ORDER_TYPE_KEYS[e.key.toLowerCase()]
    if (t && (t === 'Hold' || draftTypes.includes(t))) {
      e.preventDefault()
      setType(t)
    }
  }

  function applyProvince(dsvgId: string) {
    if (!draft || currentStep?.kind !== 'province') return
    const next = applyChoice(draft, currentStep, dsvgId)
    if (!next) return
    draft = next
    recompute()
  }

  function handleProvinceClick(dsvgId: string) {
    if (phase === 'retreat') return handleRetreatClick(dsvgId)
    if (phase === 'build') return handleBuildClick(dsvgId)
    handleMovementClick(dsvgId)
  }

  function handleMovementClick(dsvgId: string) {
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
    retreatSel = null
    buildSel = null
  }

  function deleteOrder(source: string) {
    orders = orders.filter((o) => (o as { source: string }).source !== source)
    notifyOrders()
  }

  const setOrder = (source: string, order: AnyOrder) => {
    orders = [...orders.filter((o) => orderSource(o) !== source), order]
    notifyOrders()
  }

  // ── retreat phase ─────────────────────────────────────────────────────────
  // Every dislodged unit is drawn on the map (all nations'), so a retreating unit stays
  // visible beside the occupier that pushed it out — not just the viewer's own.
  $: dislodgedUnits = dislodged.map((d) => d.unit)
  $: myDislodged = dislodged.filter((d) => controllable(d.unit.nation))
  const dislodgedAt = (p: string) => myDislodged.find((d) => d.unit.territory === p)

  /** Coast-specific retreat destinations for a dislodged unit. */
  const retreatChoices = (p: string) => retreatChoicesFor(mapDef, dislodgedAt(p), units, contested)

  function handleRetreatClick(dsvgId: string) {
    const gid = toGameId(dsvgId)
    if (retreatSel === null) {
      if (dislodgedAt(gid)) retreatSel = gid
      return
    }
    const choice = retreatChoices(retreatSel).find((c) => toDsvgId(c.province, c.coast) === dsvgId)
    if (choice) {
      const d = dislodgedAt(retreatSel)!
      setOrder(retreatSel, {
        type: 'Retreat',
        nation: d.unit.nation,
        source: retreatSel,
        sourceCoast: d.unit.coast,
        target: choice.province,
        targetCoast: choice.coast,
      } as RetreatOrder)
      retreatSel = null
    } else if (gid === retreatSel) {
      retreatSel = null // click the selected unit again to deselect
    }
  }

  function disbandSelected() {
    if (!retreatSel) return
    const d = dislodgedAt(retreatSel)!
    setOrder(retreatSel, { type: 'Disband', nation: d.unit.nation, source: retreatSel, sourceCoast: d.unit.coast } as RetreatOrder)
    retreatSel = null
  }

  // ── build phase ───────────────────────────────────────────────────────────
  $: buildNations = controlAll
    ? [...new Set([...units.map((u) => u.nation), ...Object.values(supplyCenters)])]
    : nation
      ? [nation]
      : []
  $: buildSituations = buildNations.map((n) => ({ nation: n, ...buildSituation(mapDef, n, supplyCenters, units) }))
  // Open home centers still buildable, and units still removable.
  $: buildSpots = openBuildSpots(buildSituations, orders)
  $: removeChoices = openRemovals(buildSituations, orders)
  const buildSpotAt = (p: string) => buildSpots.find((sp) => sp.province === p)
  $: buildSpotChoice = buildSel
    ? buildSituations.flatMap((s) => s.spots).find((sp) => sp.province === buildSel!.province)
    : null

  // A nation with nothing to do this phase is auto-readied server-side (see idleNations);
  // the panel shows a calm "Waiting…" rather than a Submit button. Live play only —
  // sandbox/god-mode always lets you act.
  $: amIdle =
    !onResolve &&
    !controlAll &&
    Boolean(nation) &&
    isOrderPhase(phase) &&
    isIdle(mapDef, { phase, units, supplyCenters, dislodged }, nation)

  function handleBuildClick(dsvgId: string) {
    const gid = toGameId(dsvgId)
    // clicking an already-placed build/remove undoes it
    const existing = orders.find(
      (o) => (o.type === 'Build' || o.type === 'Remove') && (o as BuildOrder).source === gid,
    )
    if (existing) {
      orders = orders.filter((o) => o !== existing)
      buildSel = null
      notifyOrders()
      return
    }
    const spot = buildSpotAt(gid)
    if (spot) {
      // Commit position + selection together so the popup never renders at the new
      // spot with the previous province's cards (which looked like a flicker).
      popupPos = lastPointer
      buildSel = { province: gid, nation: spot.nation }
      buildJustOpened = true // keep the popup through this click's bubble to the map area
      return
    }
    const removable = removeChoices.find((r) => r.territory === gid)
    if (removable) {
      orders = [...orders, { type: 'Remove', nation: removable.nation, source: gid } as BuildOrder]
      notifyOrders()
    }
  }

  function placeBuild(unitType: 'army' | 'fleet', coast?: string) {
    if (!buildSel) return
    orders = [
      ...orders,
      { type: 'Build', nation: buildSel.nation, source: buildSel.province, unitType, sourceCoast: coast } as BuildOrder,
    ]
    buildSel = null
    notifyOrders()
  }

  // Stage the click point; it's committed to popupPos only when buildSel changes.
  function recordPointer(e: PointerEvent) {
    if (!mapArea) return
    const r = mapArea.getBoundingClientRect()
    lastPointer = { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  // A click anywhere in the map area that didn't just open the popup dismisses it.
  function onMapAreaClick() {
    if (buildJustOpened) {
      buildJustOpened = false
      return
    }
    if (buildSel) buildSel = null
  }

  // ── map inputs, per phase ─────────────────────────────────────────────────
  // Movement: wizard choices; units targeted at province level (coast collapsed)
  // so a fleet on a multi-coast province highlights the whole province on hover.
  $: moveHighlighted =
    currentStep?.kind === 'province' ? currentStep.choices.map((c) => toDsvgId(c.id, c.coast)) : []
  $: draftCtx = draft ? context(draft) : null
  $: draftTypes = draftCtx ? applicableOrderTypes(draftCtx) : []
  $: moveSelectable = !draft
    ? ownUnits.map((u) => toDsvgId(u.territory))
    : [...moveHighlighted, toDsvgId(draft.source)]
  // Fleets already chosen for a convoy route stay marked while the route is built.
  $: convoyChain = (draft?.convoyPath ?? []).map((p) => toDsvgId(p))

  // Retreat: the dislodged units awaiting an order, or the picked one's destinations.
  $: retreatMap = retreatMapInputs(mapDef, myDislodged, orders, units, contested, retreatSel)
  // Build: open slots as dashed "+" rings; placed builds/removes stay clickable to undo.
  $: buildMap = buildMapInputs(buildSpots, removeChoices, orders)

  $: highlighted = readOnly ? [] : phase === 'retreat' ? retreatMap.highlighted : phase === 'build' ? [] : moveHighlighted
  $: selectable = readOnly ? [] : phase === 'retreat' ? retreatMap.selectable : phase === 'build' ? buildMap.selectable : moveSelectable
  $: mapBuildSlots = !readOnly && phase === 'build' ? buildMap.buildIds : []
  $: mapRemoveSlots = !readOnly && phase === 'build' ? buildMap.removeIds : []

  // Movement: amber-flag own units that still have no order so none get forgotten.
  $: unorderedSlots = canAct && phase === 'movement' ? unorderedUnitIds(ownUnits, orders, draft?.source) : []

  // Map overlays per order kind: movement/retreat as arrows, builds as ghost unit
  // tokens, removes/disbands as red markers. Read-only history uses resolved orders.
  $: renderOrders = toRenderOrders(readOnly ? historyOrders : orders)

  const provinceName = (id: string): string => mapDef.territories[id]?.name ?? id
  $: draftUnit = draft ? units.find((u) => u.territory === draft!.source) : undefined
  $: draftLabel = draftUnit
    ? `${draftUnit.type === 'fleet' ? 'Fleet' : 'Army'} ${provinceName(draft!.source)}`
    : ''

  $: retreatLabel = (() => {
    if (!retreatSel) return ''
    const d = dislodgedAt(retreatSel)
    return d ? `${d.unit.type === 'fleet' ? 'Fleet' : 'Army'} ${provinceName(retreatSel)} dislodged` : ''
  })()

  $: buildPrompt = buildPromptFor(buildSituations)

  // Reactive so the panels re-render their order text when the board changes.
  $: formatOrder = (o: AnyOrder): string => formatAnyOrder(mapDef, units, dislodged, o)
</script>

<svelte:window on:keydown={onKeydown} />

<div class="game">
  {#if hasRail}
    <LeftRail {title} {onExit} width={leftWidth} open={leftOpen} onClose={() => (leftOpen = false)}>
      <slot name="left" />
    </LeftRail>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="map-area" bind:this={mapArea} on:pointerdown={recordPointer} on:click={onMapAreaClick}>
    <DiplomacyMap
      fill
      {mapDef}
      {units}
      dislodged={dislodgedUnits}
      {ownership}
      orders={renderOrders}
      {highlighted}
      selectedTerritory={convoyChain.at(-1) ?? null}
      {selectable}
      buildSlots={mapBuildSlots}
      removeSlots={mapRemoveSlots}
      {unorderedSlots}
      {spotlightNation}
      onProvinceClick={canAct ? handleProvinceClick : null}
    />

    {#if $$slots['map-action']}
      <div class="map-action"><slot name="map-action" /></div>
    {/if}

    {#if phase !== 'lobby' && Object.keys(supplyCenters).length}
      <SupplyCenterCard
        powers={mapDef.powers}
        {supplyCenters}
        {nation}
        onHover={(n) => (spotlightNation = n ?? '')}
      />
    {/if}

    {#if buildSel && buildSpotChoice}
      <BuildPicker
        {mapDef}
        province={buildSel.province}
        nation={buildSel.nation}
        spot={buildSpotChoice}
        x={popupPos.x}
        y={popupPos.y}
        onPick={placeBuild}
      />
    {/if}
  </div>

  <aside class="sidebar">

    <PhaseHeader
      {phase}
      {season}
      {year}
      {onPhaseBack}
      {onPhaseForward}
      {canPhaseBack}
      {canPhaseForward}
      hasMenu={hasRail}
      menuOpen={leftOpen}
      onToggleMenu={() => (leftOpen = !leftOpen)}
    />

    <DeadlineBanner {deadline} {graceEndsAt} {awaiting} />

    {#if $$slots.toolbar}
      <div class="side-toolbar"><slot name="toolbar" /></div>
    {/if}

    <div class="side-body">
      <OrderPanel
        {readOnly}
        {canAct}
        {phase}
        {historyOrders}
        {orders}
        format={formatOrder}
        drafting={Boolean(draft)}
        draftType={draft?.type}
        {draftLabel}
        {draftTypes}
        {currentStep}
        hasDislodged={myDislodged.length > 0}
        retreating={Boolean(retreatSel)}
        {retreatLabel}
        buildingAt={buildSel ? provinceName(buildSel.province) : null}
        {buildPrompt}
        onCancel={cancel}
        onSetType={setType}
        onDisband={disbandSelected}
        onDelete={deleteOrder}
      >
        <SubmitControls
          sandbox={Boolean(onResolve)}
          idle={amIdle}
          {saving}
          ready={effectiveReady}
          dirty={dirtySinceSubmit}
          resubmitted={hasResubmitted}
          error={saveError}
          locked={submittedOrders}
          format={formatOrder}
          onSubmit={onResolve ? () => onResolve?.(withImplicitHolds(orders, phase, ownUnits)) : submit}
          onDiscard={discardChanges}
        />
      </OrderPanel>

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
    position: relative;
  }
  /* Phones and portrait tablets: map on top, orders below in a scrollable sheet. */
  @media (max-width: 760px), (orientation: portrait) and (max-width: 1100px) {
    .game {
      flex-direction: column;
    }
    .map-area {
      flex: 1 1 auto;
      min-height: 52vh;
    }
    .sidebar {
      width: auto !important;
      flex: 0 1 auto;
      max-height: 46vh;
      border-left: none;
      border-top: 1px solid var(--border, #e5e7eb);
    }
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
  /* Overlay action mirrored to the supply-center card, hugging the sidebar's edge. */
  .map-action {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 15;
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
</style>
