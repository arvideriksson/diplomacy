<script lang="ts">
  import type { Unit } from '../lib/game'
  import { submitOrders, fetchMyOrders, saveDraftOrders } from '../lib/game'
  import { onDestroy, tick } from 'svelte'
  import { errorMessage } from '../lib/errors'
  import { createDebouncer } from '../lib/debounce'
  import { readDraftBackup, writeDraftBackup, sameOrders } from '../lib/draftBackup'
  import { isOrderPhase } from '../lib/phases'
  import { sameNation } from '../lib/powers'
  import type { MapDefinition } from '../lib/mapDefinition'
  import DiplomacyMap from './DiplomacyMap.svelte'
  import { toDsvgId, toGameId } from '../lib/map/idMap'
  import type { AnyOrder, BuildOrder, OrderType, RetreatOrder } from '../lib/orders/types'
  import { nextStep, finalize, applicableOrderTypes, type Draft, type Step, type WizardContext } from '../lib/orders/wizard'
  import { buildSituation } from '../lib/orders/adjustments'
  import { canConvoyFrom } from '../lib/adjudicator/rules'
  import { BUBBLE_ICONS, ORDER_BUBBLES, type Bubble, type BubbleMenu } from '../lib/orders/bubbles'
  import { compact, type GameTab } from '../lib/layout'
  import { powerColor, powerName } from '../lib/powers'
  import {
    orderSource, withImplicitHolds, toRenderOrders, applyChoice, commitMove, ORDER_TYPE_KEYS, unorderedUnitIds,
    retreatChoices as retreatChoicesFor, retreatMapInputs,
    openBuildSpots, openRemovals, buildMapInputs, buildPrompt as buildPromptFor, coastName,
  } from '../lib/orders/board'
  import { isIdle } from '../lib/adjudicator/idle'
  import { formatAnyOrder, describeAnyOrder } from '../lib/orders/notation'
  import { choiceNotes } from '../lib/orders/board'
  import SupplyCenterCard from './SupplyCenterCard.svelte'
  import LeftRail from './LeftRail.svelte'
  import DeadlineBanner from './DeadlineBanner.svelte'
  import OrderPanel from './OrderPanel.svelte'
  import SubmitControls from './SubmitControls.svelte'
  import PhaseHeader from './PhaseHeader.svelte'
  import GameTopBar from './GameTopBar.svelte'
  import GameTabs from './GameTabs.svelte'

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
  /** History: jump straight back to the live phase (shown while viewing the past). */
  export let onPhaseLatest: (() => void) | null = null
  /** Label for the leave button on phones (e.g. "Game" when it leads out of a sandbox). */
  export let exitLabel: string = ''
  /** Phones: the visible pane. */
  export let tab: GameTab = 'map'
  /** God mode: whose units the phone map opens on (defaults to the whole board). */
  export let focusNation: string = ''
  /** A passing note shown on the map (e.g. a sandbox resolution summary); tapping it
   *  opens the Orders pane. Cleared by the parent. */
  export let notice: string = ''
  /** Unread press messages, badged on the Press tab. */
  export let pressBadge: number = 0
  /** Notified with the current order set whenever it changes (including on load). */
  export let onOrdersChange: ((orders: AnyOrder[]) => void) | null = null

  let orders: AnyOrder[] = []
  let spotlightNation = '' // nation whose SCs are spotlit (hovering the SC card)
  let draft: Draft | null = null // movement wizard
  let currentStep: Step | null = null
  let retreatSel: string | null = null // dislodged unit's province picked (retreat)
  let retreatRouting = false // …and its Retreat bubble chosen: destinations highlighted
  let buildSel: { province: string; nation: string } | null = null // center awaiting unit type (build)
  let removeSel: { territory: string; nation: string } | null = null // unit offered for removal (build)
  let saving = false
  let saveError = ''
  // Optimistic ready state: submit flips the UI immediately instead of waiting
  // for `ready` to round-trip back through the parent's realtime subscription. Cleared
  // once the prop catches up (or on round change).
  let readyOverride: boolean | null = null
  $: effectiveReady = readyOverride ?? ready
  // The same, read immediately — handlers run before reactive statements re-derive it.
  const isReady = () => readyOverride ?? ready
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
  // A pending save is dropped (not flushed) on round change and submit, but flushed when
  // the view goes away or the page is hidden — phones leave fast (back, app switch).
  const draftSave = createDebouncer(() => saveDraftNow(), DRAFT_DEBOUNCE_MS)

  let mapRef: { reveal: (dsvgId: string) => void; toggleFit: () => void } | undefined
  let wholeBoard = false

  // Narrow screens: whether the left rail (title, Leave, chat / unit styles) drawer is open.
  let leftOpen = false

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
      retreatRouting = false
      buildSel = null
      removeSel = null
      dirtySinceSubmit = false
      readyOverride = null
      hasResubmitted = false
      submittedOrders = [] // loadOrders() repopulates it for an already-ready nation
      saveError = '' // clear any "catching up…" notice once the new round arrives
      draftSave.cancel()
      if (onResolve) orders = initialOrders ?? [] // sandbox: preset
      else if (gameId && nation && isOrderPhase(phase)) loadOrders() // live: reload saved
      else orders = []
      if (!onResolve) onOrdersChange?.(orders)
    }
  }

  // Notify the parent of a user edit (sandbox stores it / forks the timeline) and,
  // in live play, persist the change: autosave the draft while unsubmitted, or just
  // flag unsaved edits once submitted (Phase 2 edits don't persist until Resubmit).
  const notifyOrders = () => {
    onOrdersChange?.(orders)
    if (onResolve) return // sandbox: no server persistence
    if (isReady()) {
      // Unsent edits to a submitted set live only here until Resubmit — back them up so
      // leaving doesn't silently drop them; they come back flagged on the next load.
      // Only a real difference counts: putting the submitted order back is no change.
      dirtySinceSubmit = !sameOrders(orders, submittedOrders)
      if (gameId && nation) writeBackup(dirtySinceSubmit ? orders : null)
    } else scheduleDraftSave()
  }

  // One row per round holds the orders whether drafted or submitted (readiness is the
  // `ready` prop, from games.ready) — so load it directly; no draft/submitted branching.
  // Device backup of unsent orders (see draftBackup.ts): an unsaved draft, or edits to a
  // submitted set. Restored on the next load instead of being lost.
  const round = () => ({ gameId, nation, year, season, phase })
  const writeBackup = (set: AnyOrder[] | null) => writeDraftBackup(round(), set)
  const readBackup = () => readDraftBackup(round())

  async function loadOrders() {
    hasResubmitted = false
    try {
      orders = await fetchMyOrders(gameId, year, season, phase)
    } catch {
      orders = []
    }
    // If the nation is already ready, the loaded set IS the locked-in set; otherwise
    // it's an unsubmitted draft and nothing is locked in yet.
    submittedOrders = isReady() ? [...orders] : []
    const backup = readBackup()
    if (backup && isReady() && !sameOrders(backup, submittedOrders)) {
      orders = backup // unsent edits to the submitted set
      dirtySinceSubmit = true
    } else if (backup) {
      orders = backup
      draftSave.schedule()
    } else writeBackup(null)
    onOrdersChange?.(orders)
  }

  // Debounced autosave of the unsubmitted draft. No-op in sandbox, once ready, or
  // outside an order phase — those never write a draft.
  function scheduleDraftSave() {
    if (onResolve || isReady() || !gameId || !nation || !isOrderPhase(phase)) return
    writeBackup(orders)
    draftSave.schedule()
  }

  async function saveDraftNow() {
    if (isReady()) return
    const sent = orders
    try {
      await saveDraftOrders(gameId, sent, { year, season, phase })
      if (sent === orders) writeBackup(null)
    } catch {
      // silent: a dropped autosave just retries on the next edit
    }
  }

  const flushDraft = () => draftSave.flush()
  const onHidden = () => document.visibilityState === 'hidden' && flushDraft()
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushDraft)
    document.addEventListener('visibilitychange', onHidden)
  }
  onDestroy(() => {
    flushDraft()
    window.removeEventListener('pagehide', flushDraft)
    document.removeEventListener('visibilitychange', onHidden)
  })

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
      readyOverride = true
      submittedOrders = [...committed] // the just-committed set is now locked in
      orders = committed // reflect the filled-in holds in the live, editable list too
      notifyOrders() // ready + identical to the locked-in set: clears the backup
      dirtySinceSubmit = false
      hasResubmitted = wasReady
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
    writeBackup(null)
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

  // Selecting a unit opens its action bubbles (an untyped draft); a bubble or shortcut
  // then picks the order type.
  function startDraft(unit: Unit) {
    dismissedNotice = notice
    draft = { source: unit.territory, sourceCoast: unit.coast }
    recompute()
    revealSoon(toDsvgId(unit.territory, unit.coast))
  }

  // Keep a selection clear of the map's edges and overlays (after the pane is shown).
  async function revealSoon(dsvgId: string) {
    await tick()
    mapRef?.reveal(dsvgId)
  }

  // Back from a typed draft to the unit's bubbles.
  function reopenMenu() {
    if (!draft) return
    draft = { source: draft.source, sourceCoast: draft.sourceCoast }
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
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
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
    const unit = ownUnits.find((u) => u.territory === gid)
    if (!draft) {
      if (unit) startDraft(unit)
      return
    }
    if (!draft.type) {
      // Bubbles open: the same unit again closes them, another unit switches to it.
      if (gid === draft.source) cancel()
      else if (unit) startDraft(unit)
      return
    }
    // Mid-order, the unit itself steps back to its bubbles.
    if (gid === draft.source) {
      reopenMenu()
      return
    }
    applyProvince(dsvgId)
  }

  function cancel() {
    draft = null
    currentStep = null
    retreatSel = null
    retreatRouting = false
    buildSel = null
    removeSel = null
  }

  // Orders list / "Next": jump to a unit on the map with its bubbles open.
  async function pickUnit(territory: string) {
    const unit = ownUnits.find((u) => u.territory === territory)
    if (!unit) return
    tab = 'map'
    startDraft(unit)
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
    if (retreatSel === null || !retreatRouting) {
      // Bubbles: pick (or switch) the dislodged unit; the same one again closes them.
      if (gid === retreatSel) cancel()
      else if (dislodgedAt(gid)) {
        retreatSel = gid
        retreatRouting = false
        revealSoon(toDsvgId(gid))
      }
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
      retreatRouting = false
    } else if (gid === retreatSel) {
      retreatRouting = false // the unit again: back to its bubbles
    }
  }

  function disbandSelected() {
    if (!retreatSel) return
    const d = dislodgedAt(retreatSel)!
    setOrder(retreatSel, { type: 'Disband', nation: d.unit.nation, source: retreatSel, sourceCoast: d.unit.coast } as RetreatOrder)
    retreatSel = null
    retreatRouting = false
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
    const same = buildSel?.province === gid || removeSel?.territory === gid
    if (existing) {
      // A placed build/removal reopens its bubbles (change type, or cancel it).
      cancel()
      if (same) return
      const b = existing as BuildOrder
      if (b.type === 'Build') buildSel = { province: gid, nation: b.nation }
      else removeSel = { territory: gid, nation: b.nation }
      revealSoon(dsvgId)
      return
    }
    cancel()
    if (same) return // the open center/unit again closes its bubbles
    const spot = buildSpotAt(gid)
    if (spot) {
      buildSel = { province: gid, nation: spot.nation }
      revealSoon(dsvgId)
      return
    }
    const removable = removeChoices.find((r) => r.territory === gid)
    if (removable) {
      removeSel = removable
      revealSoon(dsvgId)
    }
  }

  function confirmRemove() {
    if (!removeSel) return
    const at = removeSel.territory
    orders = [...orders.filter((o) => orderSource(o) !== at), { type: 'Remove', nation: removeSel.nation, source: at } as BuildOrder]
    removeSel = null
    notifyOrders()
  }

  // Cancel the placed build/removal under the open bubbles.
  function undoAdjustment() {
    const at = buildSel?.province ?? removeSel?.territory
    orders = orders.filter((o) => orderSource(o) !== at)
    cancel()
    notifyOrders()
  }

  function placeBuild(unitType: 'army' | 'fleet', coast?: string) {
    if (!buildSel) return
    const at = buildSel.province
    orders = [
      ...orders.filter((o) => orderSource(o) !== at),
      { type: 'Build', nation: buildSel.nation, source: buildSel.province, unitType, sourceCoast: coast } as BuildOrder,
    ]
    buildSel = null
    notifyOrders()
  }

  // ── action bubbles ────────────────────────────────────────────────────────
  // Movement: the selected unit's order types. Retreat: retreat / disband. Build: the
  // unit types a center can raise, or Remove for a unit owed as a removal.
  const currentOrderType = (source: string): string | undefined => orders.find((o) => orderSource(o) === source)?.type

  $: bubbleMenu = ((): BubbleMenu | null => {
    if (!canAct) return null
    if (phase === 'movement' && draft && !draft.type && draftCtx) {
      const current = currentOrderType(draft.source)
      const convoySpot = draftCtx.unit.type === 'fleet' && canConvoyFrom(mapDef, draft.source)
      const items: Bubble[] = ORDER_BUBBLES.filter(
        ({ type }) => type === 'Hold' || draftTypes.includes(type) || (type === 'Convoy' && convoySpot),
      ).map(({ type, key }) => ({
        id: type,
        label: type,
        icon: BUBBLE_ICONS[type],
        key,
        active: current === type,
        disabled: type !== 'Hold' && !draftTypes.includes(type),
      }))
      return { anchor: toDsvgId(draft.source, draft.sourceCoast), items }
    }
    if (phase === 'retreat' && retreatSel && !retreatRouting) {
      const d = myDislodged.find((x) => x.unit.territory === retreatSel)
      if (!d) return null
      const current = currentOrderType(retreatSel)
      return {
        anchor: toDsvgId(retreatSel, d.unit.coast),
        items: [
          { id: 'Retreat', label: 'Retreat', icon: BUBBLE_ICONS.Retreat, active: current === 'Retreat', disabled: retreatChoices(retreatSel).length === 0 },
          { id: 'Disband', label: 'Disband', icon: BUBBLE_ICONS.Disband, active: current === 'Disband', tone: 'danger' },
        ],
      }
    }
    if (phase === 'build' && buildSel && buildSpotChoice) {
      const color = powerColor(mapDef.powers, buildSel.nation, '#888')
      const placed = orders.find((o) => o.type === 'Build' && orderSource(o) === buildSel!.province) as BuildOrder | undefined
      const is = (t: string, c?: string) => placed?.unitType === t && (c === undefined || placed?.sourceCoast === c)
      const items: Bubble[] = []
      if (buildSpotChoice.types.includes('army')) items.push({ id: 'army', label: 'Army', token: { type: 'Army', color }, active: is('army') })
      if (buildSpotChoice.types.includes('fleet')) {
        const coasts = buildSpotChoice.coasts ?? []
        if (coasts.length > 1) {
          for (const c of coasts)
            items.push({ id: `fleet:${c}`, label: `Fleet ${coastName(mapDef, buildSel.province, c)}`, token: { type: 'Fleet', color }, active: is('fleet', c) })
        } else items.push({ id: 'fleet', label: 'Fleet', token: { type: 'Fleet', color }, active: is('fleet') })
      }
      if (placed) items.push({ id: 'undo', label: 'No build', icon: BUBBLE_ICONS.Disband, tone: 'danger' })
      return { anchor: toDsvgId(buildSel.province), items }
    }
    if (phase === 'build' && removeSel) {
      const u = units.find((x) => x.territory === removeSel!.territory)
      const placed = currentOrderType(removeSel.territory) === 'Remove'
      return {
        anchor: toDsvgId(removeSel.territory, u?.coast),
        items: placed
          ? [{ id: 'remove', label: 'Remove', icon: BUBBLE_ICONS.Remove, tone: 'danger', active: true }, { id: 'undo', label: 'Keep', icon: BUBBLE_ICONS.Hold }]
          : [{ id: 'remove', label: 'Remove', icon: BUBBLE_ICONS.Remove, tone: 'danger' }],
      }
    }
    return null
  })()

  function onBubble(id: string) {
    if (phase === 'movement') return setType(id as OrderType)
    if (phase === 'retreat') {
      if (id === 'Disband') disbandSelected()
      else retreatRouting = true
      return
    }
    if (id === 'remove') return confirmRemove()
    if (id === 'undo') return undoAdjustment()
    const [unitType, coast] = id.split(':') as ['army' | 'fleet', string | undefined]
    placeBuild(unitType, coast)
  }

  // The floating map hint while an order is being routed (or its bubbles are open).
  $: mapHint = !canAct
    ? null
    : draft && draft.type && currentStep?.kind === 'province'
      ? { title: `${draftLabel} · ${draft.type}`, text: currentStep.prompt, back: true }
      : draft && !draft.type
        ? { title: draftLabel, text: draftCurrent ? `Now: ${describeOrder(draftCurrent)} — pick to change` : 'Choose an order', back: false }
        : retreatSel && retreatRouting
          ? { title: retreatLabel, text: 'Pick a highlighted province to retreat to', back: true }
          : retreatSel
            ? { title: retreatLabel, text: 'Retreat or disband?', back: false }
            : buildSel
              ? { title: `Build in ${provinceName(buildSel.province)}`, text: 'Choose a unit type', back: false }
              : removeSel
                ? { title: `Remove from ${provinceName(removeSel.territory)}?`, text: '', back: false }
                : null

  $: draftCurrent = draft ? orders.find((o) => orderSource(o) === draft!.source) : undefined
  let dismissedNotice = ''

  function hintBack() {
    if (phase === 'retreat') retreatRouting = false
    else reopenMenu()
  }

  // ── map footer (phones): progress, next unit, submit ──────────────────────
  // The orders list in a stable order (power, then province) so edited rows don't jump.
  const byNationThenProvince = (a: AnyOrder, b: AnyOrder) =>
    a.nation.localeCompare(b.nation) || provinceName(orderSource(a)).localeCompare(provinceName(orderSource(b)))
  $: listedOrders = [...orders].sort(byNationThenProvince)
  // The order set as notation for the clipboard: un-ordered units hold in a game; a
  // sandbox (one board commanding every power) copies only the entered orders, by power.
  $: copyText = (() => {
    if (!controlAll) return withImplicitHolds(orders, phase, ownUnits).sort(byNationThenProvince).map(formatOrder).join('\n')
    const nations = [...new Set(listedOrders.map((o) => o.nation))]
    return nations
      .map((n) => [powerName(mapDef.powers, n), ...listedOrders.filter((o) => o.nation === n).map(formatOrder)].join('\n'))
      .join('\n\n')
  })()

  $: unorderedUnits = canAct && phase === 'movement' && !controlAll
    ? ownUnits.filter((u) => !orders.some((o) => orderSource(o) === u.territory))
    : []
  // Retreats and builds still to order, for the strip's "Next ›" (all phases, sandbox too).
  $: pendingRetreats = phase === 'retreat' ? myDislodged.filter((d) => !orders.some((o) => orderSource(o) === d.unit.territory)) : []
  $: pendingBuilds = phase === 'build' ? buildSituations.reduce((a, s) => a + Math.max(0, s.delta - orders.filter((o) => o.type === 'Build' && (o as BuildOrder).nation === s.nation).length), 0) : 0
  $: pendingRemovals = phase === 'build' ? buildSituations.reduce((a, s) => a + Math.max(0, -s.delta - orders.filter((o) => o.type === 'Remove' && (o as BuildOrder).nation === s.nation).length), 0) : 0
  $: pendingAdjust = !canAct
    ? null
    : pendingRetreats.length
      ? { text: `${pendingRetreats.length} retreat${pendingRetreats.length === 1 ? '' : 's'} to order` }
      : pendingBuilds && buildSpots.length
        ? { text: `${pendingBuilds} build${pendingBuilds === 1 ? '' : 's'} available` }
        : pendingRemovals
          ? { text: `${pendingRemovals} unit${pendingRemovals === 1 ? '' : 's'} to remove` }
          : null
  function nextPending() {
    const d = pendingRetreats[0]
    if (d) return handleRetreatClick(toDsvgId(d.unit.territory))
    const spot = buildSpots[0]
    if (pendingBuilds && spot) return handleBuildClick(toDsvgId(spot.province))
    const r = removeChoices[0]
    if (r) handleBuildClick(toDsvgId(r.territory))
  }

  // Orders list: tap a row to edit that order on the map.
  function editOrder(source: string) {
    if (phase === 'movement') return pickUnit(source)
    tab = 'map'
    if (phase === 'retreat') {
      cancel()
      return handleRetreatClick(toDsvgId(source))
    }
    cancel()
    handleBuildClick(toDsvgId(source))
  }

  function nextUnit() {
    const u = unorderedUnits[0]
    if (u) pickUnit(u.territory)
  }
  $: submitDone = !onResolve && effectiveReady && !dirtySinceSubmit
  $: submitLabel = onResolve ? 'Resolve' : amIdle ? 'Waiting…' : !effectiveReady ? 'Submit' : dirtySinceSubmit ? 'Resubmit' : 'Submitted'
  const doSubmit = () => (onResolve ? onResolve(withImplicitHolds(orders, phase, ownUnits)) : submit())

  // ── map inputs, per phase ─────────────────────────────────────────────────
  // Movement: wizard choices; units targeted at province level (coast collapsed)
  // so a fleet on a multi-coast province highlights the whole province on hover.
  $: moveHighlighted =
    currentStep?.kind === 'province' ? currentStep.choices.map((c) => toDsvgId(c.id, c.coast)) : []
  $: draftCtx = draft ? context(draft) : null
  $: draftTypes = draftCtx ? applicableOrderTypes(draftCtx) : []
  $: moveSelectable = !draft || !draft.type
    ? ownUnits.map((u) => toDsvgId(u.territory))
    : [...moveHighlighted, toDsvgId(draft.source)]
  // Fleets already chosen for a convoy route stay marked while the route is built.
  $: convoyChain = (draft?.convoyPath ?? []).map((p) => toDsvgId(p))

  // Retreat: the dislodged units awaiting an order, or the picked one's destinations.
  $: retreatMap = retreatMapInputs(mapDef, myDislodged, orders, units, contested, retreatRouting ? retreatSel : null)
  // Build: open slots as dashed "+" rings; placed builds/removes stay clickable to undo.
  $: buildMap = buildMapInputs(buildSpots, removeChoices, orders)

  $: highlighted = readOnly ? [] : phase === 'retreat' ? retreatMap.highlighted : phase === 'build' ? [] : moveHighlighted
  $: selectable = readOnly ? [] : phase === 'retreat' ? retreatMap.selectable : phase === 'build' ? buildMap.selectable : moveSelectable
  $: mapBuildSlots = !readOnly && phase === 'build' ? buildMap.buildIds : []
  $: mapRemoveSlots = !readOnly && phase === 'build' ? buildMap.removeIds : []

  // Movement: amber-flag own units that still have no order so none get forgotten.
  $: unorderedSlots = canAct && phase === 'movement' ? unorderedUnitIds(ownUnits, orders, draft?.source) : []
  // Phones open zoomed in on the viewer's own units.
  $: focusUnits = controlAll ? units.filter((u) => focusNation && sameNation(u.nation, focusNation)) : ownUnits
  // A retreat opens on the dislodged units instead — that's where the decisions are.
  $: retreatFocus = phase === 'retreat' ? myDislodged.map((d) => d.unit) : []
  $: coverFocus = $compact
    ? (retreatFocus.length ? retreatFocus : focusUnits.length ? focusUnits : units).map((u) => toDsvgId(u.territory))
    : null

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

  // The to-do lists cover what's left to place; the prompt only speaks when they're empty.
  $: buildPrompt = phase !== 'build' || todos.length || orders.length ? '' : buildPromptFor(buildSituations)

  const unitLabel = (u: Unit) => `${u.type === 'fleet' ? 'Fleet' : 'Army'} ${provinceName(u.territory)}`
  const placedFor = (type: 'Build' | 'Remove', n: string) => orders.filter((o) => o.type === type && o.nation === n).length
  // Build-phase to-dos, one group per power (several in a sandbox), each tagged with
  // the power when one board commands them all.
  $: adjustTodos = !canAct || phase !== 'build'
    ? []
    : buildSituations.flatMap((s) => {
        const power = controlAll ? { name: powerName(mapDef.powers, s.nation), color: powerColor(mapDef.powers, s.nation, '#888') } : undefined
        const builds = s.delta - placedFor('Build', s.nation)
        const removes = -s.delta - placedFor('Remove', s.nation)
        const spots = buildSpots.filter((sp) => sp.nation === s.nation)
        const removable = removeChoices.filter((r) => r.nation === s.nation)
        return [
          builds > 0 && spots.length
            ? { key: `build:${s.nation}`, title: power ? 'Builds' : 'Builds available', count: builds, go: 'Build', power,
                items: spots.map((sp) => ({ id: sp.province, label: provinceName(sp.province) })) }
            : null,
          removes > 0 && removable.length
            ? { key: `remove:${s.nation}`, title: power ? 'Removals' : 'Units to remove', count: removes, go: 'Remove', power,
                items: removable.map((r) => {
                  const u = units.find((x) => x.territory === r.territory)
                  return { id: r.territory, label: u ? unitLabel(u) : provinceName(r.territory) }
                }) }
            : null,
        ].filter((t) => t !== null)
      })
      .sort((a, b) => (a.power?.name ?? '').localeCompare(b.power?.name ?? ''))
  $: todos = phase === 'movement' && unorderedUnits.length
    ? [{ key: 'unordered', title: 'Needs an order', count: unorderedUnits.length, go: 'Order', items: unorderedUnits.map((u) => ({ id: u.territory, label: unitLabel(u) })) }]
    : adjustTodos
  // A to-do row: open that unit's / center's bubbles on the map.
  function pickTodo(id: string) {
    if (phase === 'movement') return pickUnit(id)
    tab = 'map'
    if (!(buildSel?.province === id || removeSel?.territory === id)) handleBuildClick(toDsvgId(id))
  }

  // Supports that can't count as entered: support-hold of a unit you've ordered to move,
  // or support-move that doesn't match the move you gave it.
  function supportWarning(o: AnyOrder): string {
    if (o.type !== 'Support') return ''
    const aux = orders.find((x) => orderSource(x) === o.aux)
    if (!aux) return ''
    const holding = !o.target || o.target === o.aux
    if (holding && aux.type === 'Move') return `Won't count — ${provinceName(o.aux ?? '')} is moving`
    if (!holding && (aux.type !== 'Move' || (aux as { target?: string }).target !== o.target))
      return `Won't count — ${provinceName(o.aux ?? '')} isn't moving there`
    return ''
  }

  // Reactive so the panels re-render their order text when the board changes.
  $: formatOrder = (o: AnyOrder): string => formatAnyOrder(mapDef, units, dislodged, o)
  $: describeOrder = (o: AnyOrder): string => describeAnyOrder(mapDef, o)
</script>

<svelte:window on:keydown={onKeydown} />

<div class="game" class:compact={$compact} class:sandbox={Boolean(onResolve)} data-tab={tab}>
  {#if $compact}
    <GameTopBar
      {title}
      {phase}
      {season}
      {year}
      {onExit}
      {exitLabel}
      {onPhaseBack}
      {onPhaseForward}
      {canPhaseBack}
      {canPhaseForward}
      past={readOnly && Boolean(onPhaseLatest)}
      {deadline}
      {graceEndsAt}
      sandbox={Boolean(onResolve)}
    >
      <slot name="map-action" />
    </GameTopBar>
  {/if}

  <div class="panes">
    {#if $compact}
      <section class="pane press-pane" aria-hidden={tab !== 'press'}>
        {#if $$slots.left}
          <slot name="left" />
        {:else}
          <p class="pane-empty">{onResolve ? 'Press stays with the real game.' : nation ? 'Press is off in this game.' : 'Spectators can’t send press.'}</p>
        {/if}
      </section>
    {:else if hasRail}
      <LeftRail {title} {onExit} width={leftWidth} open={leftOpen} onClose={() => (leftOpen = false)}>
        <slot name="left" />
      </LeftRail>
    {/if}

    <div class="map-area pane" aria-hidden={$compact && tab !== 'map'}>
      <DiplomacyMap
        bind:this={mapRef}
        bind:wholeBoard
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
        {coverFocus}
        padBottom={$compact ? 76 : 0}
        bubbles={bubbleMenu}
        {onBubble}
        onBackgroundClick={canAct ? cancel : null}
        onProvinceClick={canAct ? handleProvinceClick : null}
      />

      <div class="map-action">
        {#if !$compact}<slot name="map-action" />{/if}
        <button
          class="glass fit-btn"
          on:click={() => mapRef?.toggleFit()}
          title={wholeBoard ? 'Zoom to your units' : 'Show the whole board'}
          aria-label={wholeBoard ? 'Zoom to your units' : 'Show the whole board'}
        >
          {#if wholeBoard}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5M11 8v6M8 11h6" /></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          {/if}
        </button>
      </div>

      {#if phase !== 'lobby' && Object.keys(supplyCenters).length}
        <SupplyCenterCard
          powers={mapDef.powers}
          {supplyCenters}
          {nation}
          onHover={(n) => (spotlightNation = n ?? '')}
        />
      {/if}

      <div class="map-foot">
        {#if notice && notice !== dismissedNotice && !mapHint}
          <div class="glass notice">
            <button class="notice-body" on:click={() => (tab = 'orders')}>
              <span>{notice}</span>
              {#if $compact}<span class="notice-go">Details ›</span>{/if}
            </button>
            <button class="notice-x" on:click={() => (dismissedNotice = notice)} aria-label="Dismiss">✕</button>
          </div>
        {/if}
        {#if mapHint}
          <div class="glass hint" role="status">
            {#if mapHint.back}
              <button class="hint-btn" on:click={hintBack} aria-label="Back to actions">‹</button>
            {/if}
            <div class="hint-text">
              <strong>{mapHint.title}</strong>
              {#if mapHint.text}<span>{mapHint.text}</span>{/if}
              {#if currentStep?.kind === 'province' && draft?.type}
                {#each choiceNotes(currentStep.choices) as [note, names]}
                  <span class="hint-note">{note}: {names}</span>
                {/each}
              {/if}
            </div>
            <button class="hint-btn" on:click={cancel} aria-label="Cancel">✕</button>
          </div>
        {:else if $compact && canAct && isOrderPhase(phase)}
          <div class="glass strip">
            <div class="strip-info">
              {#if pendingAdjust}
                <button class="strip-next" on:click={nextPending}>
                  <span class="dot"></span>{pendingAdjust.text}
                  <span class="next">Next ›</span>
                </button>
              {:else if onResolve}
                <span>{phase === 'movement' ? `You command every power · ${units.length - orders.length > 0 ? `${units.length - orders.length} units on hold` : 'all ordered'}` : phase === 'retreat' ? '✓ Every retreat is ordered' : '✓ Adjustments done'}</span>
              {:else if effectiveReady && dirtySinceSubmit}
                <span class="unsent">Changes not sent yet</span>
              {:else if amIdle}
                <span>Nothing to order this phase</span>
              {:else if unorderedUnits.length}
                <button class="strip-next" on:click={nextUnit}>
                  <span class="dot"></span>{unorderedUnits.length} without orders
                  <span class="next">Next ›</span>
                </button>
              {:else if phase === 'movement'}
                <span class="ok">✓ Every unit has an order</span>
              {:else}
                <span>{phase === 'retreat' ? (myDislodged.length ? 'Tap a flagged unit to retreat it' : 'No retreats') : buildPrompt}</span>
              {/if}
            </div>
            <button
              class="strip-submit"
              class:done={submitDone}
              class:resubmit={!onResolve && effectiveReady && dirtySinceSubmit}
              disabled={saving || submitDone || amIdle}
              on:click={doSubmit}
            >
              {submitDone ? '✓ Submitted' : submitLabel}
            </button>
          </div>
        {:else if $compact && readOnly && onPhaseLatest}
          <div class="glass strip">
            <div class="strip-info"><span>Viewing a past phase</span></div>
            <button class="strip-submit plain" on:click={onPhaseLatest}>Back to now ›</button>
          </div>
        {/if}
      </div>
    </div>

    <aside class="sidebar pane orders-pane" aria-hidden={$compact && tab !== 'orders'}>
      {#if !$compact}
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
      {/if}

      <DeadlineBanner {deadline} {graceEndsAt} {awaiting} brief={$compact} />

      {#if $$slots.toolbar}
        <div class="side-toolbar"><slot name="toolbar" /></div>
      {/if}

      <div class="side-body">
        <OrderPanel
          {readOnly}
          {canAct}
          {phase}
          {historyOrders}
          orders={listedOrders}
          {copyText}
          format={formatOrder}
          describe={describeOrder}
          warn={supportWarning}
          powerOf={controlAll ? (o) => ({ name: powerName(mapDef.powers, o.nation), color: powerColor(mapDef.powers, o.nation, '#888') }) : null}
          drafting={Boolean(draft)}
          hasDislodged={myDislodged.length > 0}
          retreating={Boolean(retreatSel)}
          {retreatLabel}
          {buildPrompt}
          {todos}
          onPickTodo={pickTodo}
          onEdit={editOrder}
          onCancel={cancel}
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
            describe={describeOrder}
            onSubmit={doSubmit}
            onDiscard={discardChanges}
          />
        </OrderPanel>

        {#if readOnly && onPhaseLatest}
          <button class="btn latest" on:click={onPhaseLatest}>Back to the current phase ›</button>
        {/if}

        <slot name="results" />
        <slot name="orders-extra" />
      </div>
    </aside>
  </div>

  {#if $compact}
    <GameTabs
      {tab}
      onSelect={(t) => (tab = t)}
      {pressBadge}
      ordersBadge={unorderedUnits.length}
      ordersDone={submitDone && !amIdle}
      ordersDirty={!onResolve && effectiveReady && dirtySinceSubmit}
    />
  {/if}
</div>

<style>
  /* Immersive in-game shell: map fills the left, a docked sidebar on the right. */
  .game {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
  }
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
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

  /* Phones and portrait tablets: one pane at a time behind the tab bar. Every pane
     stays mounted (map zoom, chat scroll and drafts survive tab switches); the hidden
     ones are just invisible. */
  .compact .pane {
    position: absolute;
    inset: 0;
    width: auto;
    border: none;
  }
  .compact .pane[aria-hidden='true'] {
    visibility: hidden;
    pointer-events: none;
  }
  .press-pane {
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
  }
  .pane-empty {
    margin: auto;
    padding: 24px;
    color: var(--text-secondary);
    text-align: center;
  }
  .compact .orders-pane {
    background: var(--bg);
  }
  .compact .side-body {
    padding: 14px 16px 24px;
  }

  /* Overlay action mirrored to the supply-center card, hugging the sidebar's edge. */
  .map-action {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 15;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }
  .compact .map-action {
    top: 10px;
    right: 10px;
  }
  .fit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 12px;
    color: var(--text);
    cursor: pointer;
  }
  @media (hover: hover) {
    .fit-btn:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
  }
  .notice {
    display: flex;
    align-items: center;
    width: min(100%, 460px);
    border-radius: 14px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  }
  .notice-body {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 8px 4px 8px 14px;
    border: none;
    background: none;
    color: var(--text);
    font: 600 13px var(--font);
    text-align: left;
    cursor: pointer;
  }
  .notice-body span:first-child {
    flex: 1;
  }
  .notice-x {
    flex: none;
    width: 44px;
    height: 44px;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .notice-go {
    color: var(--accent);
    font-weight: 700;
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
  .latest {
    width: 100%;
  }

  /* Bottom of the map: the routing hint, or (phones) progress + submit. */
  .map-foot {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 14px;
    z-index: 16;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    pointer-events: none;
  }
  .map-foot > :global(*) {
    pointer-events: auto;
  }
  .compact .map-foot {
    bottom: 10px;
    padding: 0 10px;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 6px;
    width: min(100%, 460px);
    padding: 6px;
    border-radius: 16px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  }
  .hint-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 4px;
    font-size: 13px;
    line-height: 1.3;
    color: var(--text-secondary);
  }
  .hint-text strong {
    font-size: 14px;
    color: var(--text);
  }
  .hint-note {
    font-size: 12px;
  }
  .hint-btn {
    flex: none;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 12px;
    background: var(--bg-hover);
    color: var(--text);
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
  }
  .hint-btn:hover {
    background: var(--accent-subtle);
    color: var(--accent);
  }
  .strip {
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(100%, 460px);
    padding: 6px 6px 6px 12px;
    border-radius: 16px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  }
  .strip-info {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .strip-info .unsent {
    color: var(--accent);
  }
  .strip-info .ok {
    color: var(--green);
  }
  .strip-next {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 40px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: 600 13px var(--font);
    cursor: pointer;
  }
  .strip-next .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--amber);
    flex: none;
  }
  .strip-next .next {
    color: var(--accent);
    font-weight: 700;
  }
  .strip-submit {
    flex: none;
    min-width: 112px;
    height: 44px;
    padding: 0 16px;
    border: 2px solid transparent;
    border-radius: 12px;
    background: var(--green);
    color: #fff;
    font: 700 15px var(--font);
    cursor: pointer;
  }
  .sandbox .strip-submit {
    background: var(--amber);
  }
  .strip-submit.resubmit {
    background: var(--accent);
  }
  .strip-submit.plain {
    background: var(--accent);
  }
  .strip-submit.done {
    background: transparent;
    border-color: currentColor;
    color: var(--green);
    cursor: default;
  }
  .strip-submit:disabled:not(.done) {
    opacity: 0.6;
    cursor: default;
  }
</style>
