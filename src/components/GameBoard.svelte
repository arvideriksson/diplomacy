<script lang="ts">
  import type { Unit } from '../lib/game'
  import { submitOrders, fetchMyOrders, saveDraftOrders } from '../lib/game'
  import { onDestroy } from 'svelte'
  import { errorMessage } from '../lib/errors'
  import type { MapDefinition } from '../lib/mapDefinition'
  import DiplomacyMap from './DiplomacyMap.svelte'
  import { toDsvgId, toGameId } from '../lib/map/idMap'
  import type { AnyOrder, BuildOrder, Order, OrderType, RetreatOrder } from '../lib/orders/types'
  import {
    nextStep,
    finalize,
    toOrderStates,
    applicableOrderTypes,
    type Draft,
    type Step,
    type WizardContext,
  } from '../lib/orders/wizard'
  import { retreatTargets, buildSituation } from '../lib/orders/adjustments'
  import { formatAnyOrder } from '../lib/orders/notation'
  import type { OrderState } from '../lib/map/mapRenderer'
  import { unitTokenSvg } from '../lib/map/unitStyles'
  import { unitStyle } from '../lib/unitStyle'
  import SupplyCenterCard from './SupplyCenterCard.svelte'

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

  let orders: AnyOrder[] = []
  let spotlightNation = '' // nation whose SCs are spotlit (hovering the SC card)
  let draft: Draft | null = null // movement wizard
  let currentStep: Step | null = null
  let retreatSel: string | null = null // dislodged unit's province being routed (retreat)
  let buildSel: { province: string; nation: string } | null = null // center awaiting unit type (build)
  let saving = false
  let saveError = ''
  // Live autosave of the unsubmitted draft (Phase 1, !ready); silent, no status UI.
  let draftTimer: ReturnType<typeof setTimeout> | null = null
  // Optimistic ready state: submit flips the UI immediately instead of waiting
  // for `ready` to round-trip back through the parent's realtime subscription. Cleared
  // once the prop catches up (or on round change).
  let readyOverride: boolean | null = null
  $: effectiveReady = readyOverride ?? ready
  $: if (readyOverride !== null && ready === readyOverride) readyOverride = null
  // Edits made after submitting (Phase 2) are ephemeral until Resubmit — flag them.
  let dirtySinceSubmit = false
  // True only after the user clicks Resubmit *in this view* (drives Submitted vs
  // Resubmitted). Reset on every load — on entry we can't tell submit from resubmit,
  // so an already-submitted game always reads as the calm "Submitted".
  let hasResubmitted = false

  // Submit-button state machine:
  //   not submitted        → green  "Submit"
  //   submitted, no edits   → green  "Submitted"   (pressed, inert)
  //   submitted, edited     → blue   "Resubmit"
  //   resubmitted, no edits → blue   "Resubmitted" (pressed, inert)
  $: submitPressed = effectiveReady && !dirtySinceSubmit && !saving
  $: submitTone = !effectiveReady || (!dirtySinceSubmit && !hasResubmitted) ? 'submit' : 'resubmit'
  $: submitLabel = saving
    ? effectiveReady
      ? 'Resubmitting…'
      : 'Submitting…'
    : !effectiveReady
      ? 'Submit'
      : dirtySinceSubmit
        ? 'Resubmit'
        : hasResubmitted
          ? 'Resubmitted'
          : 'Submitted'
  const DRAFT_DEBOUNCE_MS = 750

  // Build type-picker popup: anchored at the clicked point within the map area.
  let mapArea: HTMLDivElement | undefined
  let lastPointer = { x: 0, y: 0 } // staged on pointerdown
  let popupPos = { x: 0, y: 0 } // committed only when the selection changes (avoids flicker)
  let buildJustOpened = false

  const ORDER_PHASES = ['movement', 'retreat', 'build']
  $: canAct = !readOnly && (controlAll || Boolean(nation)) && ORDER_PHASES.includes(phase)

  // Phase banner: human label + theme color key. The color keys map to tokens in
  // app.css that already define light/dark variants (--{key} / --{key}-subtle).
  const PHASE_META: Record<string, { label: string; tone: string }> = {
    movement: { label: 'Movement', tone: 'accent' },
    retreat: { label: 'Retreat', tone: 'amber' },
    build: { label: 'Build', tone: 'green' },
  }
  $: phaseMeta = PHASE_META[phase] ?? { label: phase, tone: 'accent' }

  const MOVE_TYPES = ['Hold', 'Move', 'Support', 'Convoy']

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
      if (draftTimer) { clearTimeout(draftTimer); draftTimer = null }
      if (onResolve) orders = initialOrders ?? [] // sandbox: preset
      else if (gameId && nation && ORDER_PHASES.includes(phase)) loadOrders() // live: reload saved
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
  }

  // Debounced autosave of the unsubmitted draft. No-op in sandbox, once ready, or
  // outside an order phase — those never write a draft.
  function scheduleDraftSave() {
    if (onResolve || effectiveReady || !gameId || !nation || !ORDER_PHASES.includes(phase)) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(saveDraftNow, DRAFT_DEBOUNCE_MS)
  }

  async function saveDraftNow() {
    draftTimer = null
    if (effectiveReady) return
    try {
      await saveDraftOrders(gameId, orders)
    } catch {
      // silent: a dropped autosave just retries on the next edit
    }
  }

  onDestroy(() => {
    if (draftTimer) clearTimeout(draftTimer)
  })

  // Submit (or resubmit): the orders row becomes the only persisted truth and the
  // draft is dropped server-side. Cancels any pending autosave and clears dirty.
  async function submit() {
    if (!gameId || !nation) return
    saving = true
    saveError = ''
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null }
    const wasReady = effectiveReady // a commit while already submitted is a *re*submit
    try {
      await submitOrders(gameId, orders, true)
      dirtySinceSubmit = false
      readyOverride = true
      hasResubmitted = wasReady
    } catch (e) {
      saveError = errorMessage(e)
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
    controlAll || !nation || n.toLowerCase() === nation.toLowerCase()

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
    if (!canAct) return
    if (e.key === 'Escape') {
      cancel()
      return
    }
    if (!draft) return
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

  const orderSource = (o: AnyOrder): string => (o as { source: string }).source
  const setOrder = (source: string, order: AnyOrder) => {
    orders = [...orders.filter((o) => orderSource(o) !== source), order]
    notifyOrders()
  }

  // ── retreat phase ─────────────────────────────────────────────────────────
  $: myDislodged = dislodged.filter((d) => controllable(d.unit.nation))
  const dislodgedAt = (p: string) => myDislodged.find((d) => d.unit.territory === p)

  /** Coast-specific retreat destinations for a dislodged unit. */
  function retreatChoices(p: string): Array<{ province: string; coast?: string }> {
    const d = dislodgedAt(p)
    if (!d) return []
    const out: Array<{ province: string; coast?: string }> = []
    for (const t of retreatTargets(mapDef, d.unit, d.attackedFrom, units, contested)) {
      if (t.coasts.length > 0) for (const c of t.coasts) out.push({ province: t.province, coast: c })
      else out.push({ province: t.province })
    }
    return out
  }

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
  const placed = (type: 'Build' | 'Remove', n: string) =>
    orders.filter((o) => o.type === type && (o as BuildOrder).nation === n).length

  // Open home centers still buildable (nation under its build quota, center not yet ordered).
  $: buildSpots = buildSituations
    .filter((s) => s.delta > 0 && placed('Build', s.nation) < s.delta)
    .flatMap((s) =>
      s.spots
        .filter((sp) => !orders.some((o) => o.type === 'Build' && (o as BuildOrder).source === sp.province))
        .map((sp) => ({ ...sp, nation: s.nation })),
    )
  // Units still removable (nation owes removals, not yet ordered).
  $: removeChoices = buildSituations
    .filter((s) => s.delta < 0 && placed('Remove', s.nation) < -s.delta)
    .flatMap((s) =>
      s.removable
        .filter((u) => !orders.some((o) => o.type === 'Remove' && (o as BuildOrder).source === u.territory))
        .map((u) => ({ territory: u.territory, nation: s.nation })),
    )
  const buildSpotAt = (p: string) => buildSpots.find((sp) => sp.province === p)
  $: buildSpotChoice = buildSel
    ? buildSituations.flatMap((s) => s.spots).find((sp) => sp.province === buildSel!.province)
    : null

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

  /** A power's display colour, for the popup unit glyphs. */
  const powerColor = (n: string): string =>
    mapDef.powers.find((p) => p.id === n || p.name.toLowerCase() === n.toLowerCase())?.color ?? '#888'

  // Spell out coast codes for the build cards (the terse Stp(sc) form is for notation).
  const COAST_NAMES: Record<string, string> = { nc: 'North', sc: 'South', ec: 'East', wc: 'West' }
  const coastName = (c: string): string => COAST_NAMES[c.toLowerCase()] ?? c

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

  // Retreat: idle highlights the dislodged units; once one is picked, its targets.
  $: retreatHi = retreatSel
    ? retreatChoices(retreatSel).map((c) => toDsvgId(c.province, c.coast))
    : myDislodged.map((d) => toDsvgId(d.unit.territory))
  $: retreatSelectable = retreatSel ? [...retreatHi, toDsvgId(retreatSel)] : retreatHi

  // Build: available slots are drawn as dashed "+" rings (buildSlots/removeSlots),
  // not stripe highlights. Placed builds/removes show as ghost units / markers, and
  // stay clickable so you can undo them.
  $: buildSpotIds = buildSpots.map((sp) => toDsvgId(sp.province))
  $: removeIds = removeChoices.map((r) => toDsvgId(r.territory))
  $: buildSelectable = [
    ...buildSpotIds,
    ...removeIds,
    ...orders.filter((o) => o.type === 'Build' || o.type === 'Remove').map((o) => toDsvgId(orderSource(o))),
  ]

  $: highlighted = readOnly ? [] : phase === 'retreat' ? retreatHi : phase === 'build' ? [] : moveHighlighted
  $: selectable = readOnly ? [] : phase === 'retreat' ? retreatSelectable : phase === 'build' ? buildSelectable : moveSelectable
  $: mapBuildSlots = !readOnly && phase === 'build' ? buildSpotIds : []
  $: mapRemoveSlots = !readOnly && phase === 'build' ? removeIds : []

  // Movement: amber-flag own units that still have no order so none get forgotten.
  // The unit currently being drafted is excluded — it's mid-edit, not forgotten.
  $: unorderedSlots =
    canAct && phase === 'movement'
      ? ownUnits
          .filter((u) => u.territory !== draft?.source && !orders.some((o) => orderSource(o) === u.territory))
          .map((u) => toDsvgId(u.territory))
      : []

  // Map overlays per order kind: movement/retreat as arrows, builds as ghost unit
  // tokens, removes/disbands as red markers. Read-only history uses resolved orders.
  $: renderOrders = ((): OrderState[] => {
    const src = readOnly ? historyOrders : orders
    const out: OrderState[] = toOrderStates(src.filter((o) => MOVE_TYPES.includes(o.type)) as Order[])
    for (const o of src) {
      if (o.type === 'Retreat') {
        const r = o as RetreatOrder
        out.push({ type: 'Move', nation: r.nation, source: toDsvgId(r.source, r.sourceCoast), target: toDsvgId(r.target ?? '', r.targetCoast) })
      } else if (o.type === 'Disband') {
        const r = o as RetreatOrder
        out.push({ type: 'Disband', nation: r.nation, source: toDsvgId(r.source, r.sourceCoast) })
      } else if (o.type === 'Build') {
        const b = o as BuildOrder
        out.push({ type: 'Build', nation: b.nation, source: toDsvgId(b.source, b.sourceCoast), unitType: b.unitType === 'fleet' ? 'Fleet' : 'Army' })
      } else if (o.type === 'Remove') {
        const b = o as BuildOrder
        out.push({ type: 'Disband', nation: b.nation, source: toDsvgId(b.source) })
      }
    }
    return out
  })()

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

  $: buildPrompt = (() => {
    const builds = buildSituations.filter((s) => s.delta > 0).reduce((a, s) => a + s.delta, 0)
    const removes = buildSituations.filter((s) => s.delta < 0).reduce((a, s) => a - s.delta, 0)
    if (builds && removes) return 'Click a highlighted home center to build, or a unit to remove.'
    if (builds) return `Click a highlighted home center to build (${builds} available).`
    if (removes) return `Click a highlighted unit to remove (${removes} required).`
    return 'No adjustments needed this phase.'
  })()
</script>

<svelte:window on:keydown={onKeydown} />

<div class="game">
  {#if title || onExit || $$slots.left}
    <aside class="left-rail" style="width: {leftWidth}">
      {#if title || onExit}
        <div class="side-title">
          {#if onExit}
            <button class="leave" on:click={onExit} title="Leave game">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Leave
            </button>
          {/if}
          {#if title}<span class="game-name">{title}</span>{/if}
        </div>
      {/if}
      <div class="left-body"><slot name="left" /></div>
    </aside>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="map-area" bind:this={mapArea} on:pointerdown={recordPointer} on:click={onMapAreaClick}>
    <DiplomacyMap
      fill
      {mapDef}
      {units}
      {ownership}
      orders={renderOrders}
      {highlighted}
      {selectable}
      buildSlots={mapBuildSlots}
      removeSlots={mapRemoveSlots}
      {unorderedSlots}
      {spotlightNation}
      onProvinceClick={canAct ? handleProvinceClick : null}
    />

    {#if phase !== 'lobby' && Object.keys(supplyCenters).length}
      <SupplyCenterCard
        powers={mapDef.powers}
        {supplyCenters}
        {nation}
        onHover={(n) => (spotlightNation = n ?? '')}
      />
    {/if}

    {#if buildSel && buildSpotChoice}
      {@const color = powerColor(buildSel.nation)}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
      <div
        class="build-popup"
        style="left:{popupPos.x}px; top:{popupPos.y}px"
        role="group"
        aria-label="Choose unit to build"
        on:click|stopPropagation
        on:pointerdown|stopPropagation
      >
        {#if buildSpotChoice.types.includes('army')}
          <button class="build-card" on:click={() => placeBuild('army')}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <svg class="bc-token" viewBox="0 0 32 32" aria-hidden="true">{@html unitTokenSvg(16, 16, 'Army', color, 13, $unitStyle)}</svg>
            <span class="bc-label">Army</span>
          </button>
        {/if}
        {#if buildSpotChoice.types.includes('fleet')}
          {#if buildSpotChoice.coasts && buildSpotChoice.coasts.length > 1}
            {#each buildSpotChoice.coasts as c}
              <button class="build-card" on:click={() => placeBuild('fleet', c)}>
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                <svg class="bc-token" viewBox="0 0 32 32" aria-hidden="true">{@html unitTokenSvg(16, 16, 'Fleet', color, 13, $unitStyle)}</svg>
                <span class="bc-label">Fleet ({coastName(c)})</span>
              </button>
            {/each}
          {:else}
            <button class="build-card" on:click={() => placeBuild('fleet')}>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <svg class="bc-token" viewBox="0 0 32 32" aria-hidden="true">{@html unitTokenSvg(16, 16, 'Fleet', color, 13, $unitStyle)}</svg>
              <span class="bc-label">Fleet</span>
            </button>
          {/if}
        {/if}
      </div>
    {/if}
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
    </div>

    <!-- Component-wide phase banner: large, color-coded by phase. -->
    <div
      class="phase-banner"
      style="--tone: var(--{phaseMeta.tone}); --tone-subtle: var(--{phaseMeta.tone}-subtle);"
    >
      {phaseMeta.label} Phase
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
      {:else if canAct}
        <div class="panel">
          <!-- per-phase entry header -->
          {#if phase === 'movement'}
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
              {/if}
            {:else}
              <p class="prompt">
                Click a unit — it defaults to <strong>Move</strong>. Then <kbd>S</kbd> support,
                <kbd>C</kbd> convoy, <kbd>H</kbd> hold (or click the unit again to hold).
              </p>
            {/if}
          {:else if phase === 'retreat'}
            {#if myDislodged.length === 0}
              <p class="prompt">No dislodged units — nothing to retreat.</p>
            {:else if retreatSel}
              <div class="panel-head">
                <strong>{retreatLabel}</strong>
                <button class="link" on:click={cancel}>Cancel</button>
              </div>
              <p class="prompt">Click a highlighted province to retreat there, or:</p>
              <div class="type-row">
                <button class="type" on:click={disbandSelected}>Disband</button>
              </div>
            {:else}
              <p class="prompt">Click a highlighted dislodged unit to retreat or disband it.</p>
            {/if}
          {:else if phase === 'build'}
            {#if buildSel}
              <div class="panel-head">
                <strong>Build at {provinceName(buildSel.province)}</strong>
                <button class="link" on:click={cancel}>Cancel</button>
              </div>
              <p class="prompt">Pick a unit type from the card on the map.</p>
            {:else}
              <p class="prompt">{buildPrompt}</p>
            {/if}
          {/if}

          {#if orders.length}
            <ul class="orders">
              {#each orders as o (orderSource(o))}
                <li>
                  <span>{formatAnyOrder(mapDef, units, dislodged, o)}</span>
                  <button class="link" on:click={() => deleteOrder(orderSource(o))}>✕</button>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="actions">
            {#if onResolve}
              <button class="primary submit" on:click={() => onResolve?.(orders)}>Submit</button>
            {:else}
              <!-- Submit→Submitted (green) then Resubmit→Resubmitted (blue); pressed = committed, inert. -->
              <button
                class="primary"
                class:submit={submitTone === 'submit'}
                class:resubmit={submitTone === 'resubmit'}
                class:pressed={submitPressed}
                on:click={submit}
                disabled={saving || submitPressed}
              >
                {submitLabel}
              </button>
              {#if effectiveReady && dirtySinceSubmit}
                <div class="actions-secondary">
                  <button class="link" on:click={discardChanges} disabled={saving}>Discard changes</button>
                </div>
              {/if}
            {/if}
            {#if saveError}<span class="status error">{saveError}</span>{/if}
          </div>
        </div>
      {:else}
        <div class="panel">
          <p class="prompt">Order entry for the {phase} phase isn’t available.</p>
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
  /* Left rail: game/sandbox title + Leave on top, then chat (game) or unit
     styles (sandbox) below. Mirror of the right order sidebar. */
  .left-rail {
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border, #e5e7eb);
    background: var(--bg-card, #fff);
    overflow: hidden;
  }
  .left-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Build type-picker popup — a rounded card tray anchored at the clicked centre. */
  .build-popup {
    position: absolute;
    transform: translate(-50%, calc(-100% - 14px));
    display: flex;
    gap: 8px;
    padding: 8px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-card, #fff) 88%, transparent);
    backdrop-filter: blur(12px) saturate(1.4);
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
    border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
    z-index: 20;
  }
  /* little pointer at the bottom, aimed at the clicked centre */
  .build-popup::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -7px;
    width: 14px;
    height: 14px;
    transform: translateX(-50%) rotate(45deg);
    background: inherit;
    border-right: 1px solid var(--border, rgba(0, 0, 0, 0.12));
    border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  }
  .build-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 72px;
    padding: 10px 8px;
    border: 1px solid color-mix(in srgb, var(--border-strong, #cbd5e1) 70%, transparent);
    border-radius: 10px;
    /* Translucent so the tray's frosted blur reads through, matching the SC card. */
    background: color-mix(in srgb, var(--bg-input, #fff) 35%, transparent);
    color: var(--text, #1a1a1a);
    cursor: pointer;
    transition: transform 0.08s ease, border-color 0.08s ease, background 0.08s ease;
  }
  .build-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent, #6366f1);
    background: color-mix(in srgb, var(--accent, #6366f1) 18%, transparent);
  }
  .bc-token {
    width: 40px;
    height: 40px;
  }
  .bc-label {
    font-size: 12px;
    font-weight: 600;
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
  .side-title {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 14px;
    min-height: 52px;
    border-bottom: 1px solid var(--border, #eee);
  }
  .side-title .game-name {
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.2px;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: calc(100% - 180px);
  }
  .side-title .leave {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border-strong, #cbd5e1);
    background: var(--bg-input, #fff);
    color: var(--text-secondary, #555);
    border-radius: 6px;
    padding: 0 10px 0 6px;
    height: 28px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font);
    flex: none;
  }
  .side-title .leave:hover {
    border-color: var(--accent, #3b82f6);
    color: var(--accent, #3b82f6);
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
    flex: 1;
    text-align: center;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.2px;
  }
  .phase-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 14px;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--tone, var(--accent));
    background: var(--tone-subtle, var(--accent-subtle));
    border-bottom: 1px solid var(--border, #eee);
    box-shadow: inset 3px 0 0 var(--tone, var(--accent));
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
  .type-row {
    display: flex;
    flex-wrap: wrap;
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
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border, #eee);
  }
  /* Full-width, prominent primary action: Submit (green) / Resubmit (blue). */
  .actions .primary {
    width: 100%;
    padding: 12px 16px;
    border: none;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .actions .primary.submit {
    background: var(--green, #059669);
  }
  .actions .primary.resubmit {
    background: var(--accent, #2563eb);
  }
  .actions .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  /* Committed state (Submitted / Resubmitted): inverted — colored outline + text on
     the dark panel fill, rather than the solid color. Reads as "done", inert. */
  .actions .primary.pressed,
  .actions .primary.pressed:disabled {
    opacity: 1;
    cursor: default;
    box-sizing: border-box;
    background: transparent;
    border: 2px solid currentColor;
    box-shadow: none;
    filter: none;
  }
  .actions .primary.submit.pressed {
    color: var(--green, #059669);
  }
  .actions .primary.resubmit.pressed {
    color: var(--accent, #2563eb);
  }
  .actions-secondary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .actions-secondary .link {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    color: var(--text-secondary, #777);
    cursor: pointer;
  }
  .actions-secondary .link:hover {
    color: var(--text, #1a1a1a);
  }
  .actions-secondary .link:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .status {
    font-size: 12px;
    color: var(--text-secondary, #777);
  }
  .status.error {
    color: #dc2626;
  }
</style>
