<script lang="ts">
  import type { Unit } from '../lib/game'
  import { submitOrders, fetchMyOrders, saveDraftOrders } from '../lib/game'
  import { onDestroy, tick } from 'svelte'
  import { errorMessage } from '../lib/errors'
  import { createDebouncer } from '../lib/debounce'
  import { readDraftBackup, writeDraftBackup, sameOrders } from '../lib/draftBackup'
  import { isOrderPhase, PHASE_LABEL } from '../lib/phases'
  import Icon from './Icon.svelte'
  import { sameNation } from '../lib/powers'
  import type { MapDefinition } from '../lib/mapDefinition'
  import DiplomacyMap from './DiplomacyMap.svelte'
  import ActionBar from './ActionBar.svelte'
  import { toDsvgId, toGameId } from '../lib/map/idMap'
  import type { AnyOrder, BuildOrder, OrderType, RetreatOrder } from '../lib/orders/types'
  import { nextStep, finalize, applicableOrderTypes, type Draft, type Step, type WizardContext } from '../lib/orders/wizard'
  import { buildSituation } from '../lib/orders/adjustments'
  import { supportAux } from '../lib/orders/options'
  import { canConvoyFrom } from '../lib/adjudicator/rules'
  import type { OrderResult } from '../lib/adjudicator/types'
  import { ACTION_ICONS, ORDER_ACTIONS, type Action, type ActionMenu } from '../lib/orders/actions'
  import { compact, wideLayout, type GameTab } from '../lib/layout'
  import { powerColor, powerName } from '../lib/powers'
  import {
    orderSource, withImplicitHolds, toRenderOrders, orderFailed, supportCut, applyChoice, commitMove, unorderedUnitIds,
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
  import Modal from './Modal.svelte'
  import PhaseHeader from './PhaseHeader.svelte'
  import GameTopBar from './GameTopBar.svelte'
  import GameTabs from './GameTabs.svelte'
  import Countdown from './Countdown.svelte'

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
  /** How each history order resolved, so failed ones are crossed out on the map. */
  export let historyResults: OrderResult[] = []
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
  /** The parent shows the supply-center standings in the orders-extra slot (spotlighting
   *  through the slot's `spotlight`), so the board doesn't add its own at the sidebar's end. */
  export let standingsInSidebar: boolean = false
  /** Notified with the current order set whenever it changes (including on load). */
  export let onOrdersChange: ((orders: AnyOrder[]) => void) | null = null

  let orders: AnyOrder[] = []
  let spotlightNation = '' // nation whose SCs are spotlit (hovering the SC card)
  let draft: Draft | null = null // movement wizard
  let currentStep: Step | null = null
  let retreatSel: string | null = null // dislodged unit's province picked (retreat)
  let retreatRouting = false // …and Retreat selected (the default): destinations highlighted
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

  let mapRef: { reveal: (dsvgId: string) => void } | undefined

  // Narrow screens: whether the left rail (title, Leave, chat / unit styles) drawer is open.
  let leftOpen = false

  // Desktop: either sidebar can be hidden to give the map the room; remembered per
  // browser. Hidden, the left rail stays mounted (chat keeps its state) and its Leave
  // button moves onto the map, so leaving is always one click away.
  const PANELS_KEY = 'game:hidden-panels'
  let leftHidden = false
  let rightHidden = false
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}')
    leftHidden = saved.left === true
    rightHidden = saved.right === true
  } catch {
    /* no storage: both sidebars start shown */
  }
  $: try {
    localStorage.setItem(PANELS_KEY, JSON.stringify({ left: leftHidden, right: rightHidden }))
  } catch {
    /* not remembered */
  }
  // The left rail is on screen: docked and not hidden (desktop), or the drawer is open.
  $: leftShown = hasRail && ($wideLayout ? !leftHidden : leftOpen)
  function toggleLeft() {
    if ($wideLayout) leftHidden = !leftHidden
    else leftOpen = !leftOpen
  }

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
    // A move's picked convoy route also orders the fleets this player controls to convoy
    // it; a support's route only chose the supported destination.
    const route = draft.type === 'Move' ? draft.convoyPath : undefined
    orders = commitMove(orders, finalize(draft, ctx), route, units, (n) => controlAll || n === nation)
    draft = null
    currentStep = null
    notifyOrders()
  }

  // Selecting a unit opens its action bar (an untyped draft, which routes a Move); an
  // action or shortcut switches the order type.
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

  // Back from a typed draft to the default (Move).
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

  // Keyboard shortcuts: Escape cancels; each open action has its own key (M move, H hold, …).
  function onKeydown(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    // [ and ] toggle the left and right sidebars.
    if (!$compact && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '[' || e.key === ']')) {
      e.preventDefault()
      if (e.key === '[') {
        if (hasRail) toggleLeft()
      } else rightHidden = !rightHidden
      return
    }
    if (!canAct) return
    if (e.key === 'Escape') {
      cancel()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Each action's shortcut, as hinted on its button.
    const action = actionMenu?.items.find((a) => a.key?.toLowerCase() === e.key.toLowerCase() && !a.disabled)
    if (action) {
      e.preventDefault()
      onAction(action.id)
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
    if (moveMode) {
      if (gid === draft.source) return setType('Hold')
      if (moveModeStep?.kind === 'province') {
        const next = applyChoice({ ...draft, type: 'Move' }, moveModeStep, dsvgId)
        if (next) {
          draft = next
          recompute()
          return
        }
      }
      if (unit) startDraft(unit)
      return
    }
    // Mid-order, the unit itself steps back to Move.
    if (gid === draft.source) {
      reopenMenu()
      return
    }
    applyProvince(dsvgId)
  }

  // Mouse: right click on a unit supports it (then picks the supported destination), middle
  // click on a fleet starts a convoy.
  function handleProvinceAuxClick(dsvgId: string, button: 'right' | 'middle') {
    if (phase !== 'movement') return
    const gid = toGameId(dsvgId)
    if (button === 'middle') {
      const unit = ownUnits.find((u) => u.territory === gid)
      if (!unit) return
      startDraft(unit)
      if (applicableOrderTypes({ map: mapDef, unit, units }).includes('Convoy')) setType('Convoy')
      return
    }
    if (!draft) return
    if (!moveMode) return handleMovementClick(dsvgId)
    if (supportable.includes(gid)) {
      draft = { source: draft.source, sourceCoast: draft.sourceCoast, type: 'Support', aux: gid }
      recompute()
    }
  }

  function cancel() {
    draft = null
    currentStep = null
    retreatSel = null
    retreatRouting = false
    buildSel = null
    removeSel = null
  }

  // Orders list / "Next": jump to a unit on the map with its actions open.
  async function pickUnit(territory: string) {
    const unit = ownUnits.find((u) => u.territory === territory)
    if (!unit) return
    tab = 'map'
    startDraft(unit)
  }

  // After submitting: put one unit's submitted order back into the draft.
  function revertOrder(source: string) {
    const was = submittedOrders.find((o) => orderSource(o) === source)
    if (was) setOrder(source, was)
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
    const choice = retreatSel && retreatRouting ? retreatChoices(retreatSel).find((c) => toDsvgId(c.province, c.coast) === dsvgId) : undefined
    if (retreatSel && choice) {
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
      cancel() // the open unit again closes its actions
    } else if (dislodgedAt(gid)) {
      selectRetreat(gid)
    }
  }

  // Pick (or switch) a dislodged unit, routing a retreat when it has anywhere to go.
  function selectRetreat(p: string) {
    retreatSel = p
    retreatRouting = retreatChoices(p).length > 0
    revealSoon(toDsvgId(p))
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
      // A placed build/removal reopens its actions (change type, or cancel it).
      cancel()
      if (same) return
      const b = existing as BuildOrder
      if (b.type === 'Build') buildSel = { province: gid, nation: b.nation }
      else removeSel = { territory: gid, nation: b.nation }
      revealSoon(dsvgId)
      return
    }
    cancel()
    if (same) return // the open center/unit again closes its actions
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

  // Cancel the placed build/removal whose actions are open.
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

  // ── action bar ────────────────────────────────────────────────────────────
  // Movement: the selected unit's order types, Move selected until another is picked.
  // Retreat: retreat (selected) / disband. Build: the unit types a center can raise, or
  // Remove for a unit owed as a removal.
  const currentOrderType = (source: string): string | undefined => orders.find((o) => orderSource(o) === source)?.type

  $: actionMenu = ((): ActionMenu | null => {
    if (!canAct) return null
    if (phase === 'movement' && draft && draftCtx) {
      const selected = draft.type ?? 'Move'
      const convoySpot = draftCtx.unit.type === 'fleet' && canConvoyFrom(mapDef, draft.source)
      const items: Action[] = ORDER_ACTIONS.filter(
        ({ type }) => type === 'Hold' || draftTypes.includes(type) || (type === 'Convoy' && convoySpot),
      ).map(({ type, key }) => ({
        id: type,
        label: type,
        icon: ACTION_ICONS[type],
        key,
        active: selected === type,
        disabled: type !== 'Hold' && !draftTypes.includes(type),
      }))
      return { anchor: toDsvgId(draft.source, draft.sourceCoast), items }
    }
    if (phase === 'retreat' && retreatSel) {
      const d = myDislodged.find((x) => x.unit.territory === retreatSel)
      if (!d) return null
      return {
        anchor: toDsvgId(retreatSel, d.unit.coast),
        dislodged: true,
        items: [
          { id: 'Retreat', label: 'Retreat', icon: ACTION_ICONS.Retreat, key: 'R', active: retreatRouting, disabled: retreatChoices(retreatSel).length === 0 },
          { id: 'Disband', label: 'Disband', icon: ACTION_ICONS.Disband, key: 'D', active: currentOrderType(retreatSel) === 'Disband', tone: 'danger' },
        ],
      }
    }
    if (phase === 'build' && buildSel && buildSpotChoice) {
      const color = powerColor(mapDef.powers, buildSel.nation, '#888')
      const placed = orders.find((o) => o.type === 'Build' && orderSource(o) === buildSel!.province) as BuildOrder | undefined
      const is = (t: string, c?: string) => placed?.unitType === t && (c === undefined || placed?.sourceCoast === c)
      const items: Action[] = []
      if (buildSpotChoice.types.includes('army')) items.push({ id: 'army', label: 'Army', token: { type: 'Army', color }, key: 'A', active: is('army') })
      if (buildSpotChoice.types.includes('fleet')) {
        const coasts = buildSpotChoice.coasts ?? []
        if (coasts.length > 1) {
          for (const c of coasts)
            items.push({ id: `fleet:${c}`, label: `Fleet ${coastName(mapDef, buildSel.province, c)}`, token: { type: 'Fleet', color }, active: is('fleet', c) })
        } else items.push({ id: 'fleet', label: 'Fleet', token: { type: 'Fleet', color }, key: 'F', active: is('fleet') })
      }
      if (placed) items.push({ id: 'undo', label: 'No build', icon: ACTION_ICONS.Disband, key: 'N', tone: 'danger' })
      return { anchor: toDsvgId(buildSel.province), items }
    }
    if (phase === 'build' && removeSel) {
      const u = units.find((x) => x.territory === removeSel!.territory)
      const placed = currentOrderType(removeSel.territory) === 'Remove'
      return {
        anchor: toDsvgId(removeSel.territory, u?.coast),
        items: placed
          ? [{ id: 'remove', label: 'Remove', icon: ACTION_ICONS.Remove, key: 'R', tone: 'danger', active: true }, { id: 'undo', label: 'Keep', icon: ACTION_ICONS.Hold, key: 'K' }]
          : [{ id: 'remove', label: 'Remove', icon: ACTION_ICONS.Remove, key: 'R', tone: 'danger' }],
      }
    }
    return null
  })()

  function onAction(id: string) {
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

  // The floating map hint above the action bar while a unit or center is picked.
  $: mapHint = !canAct
    ? null
    : draft
      ? { title: draftLabel, text: routeStep?.kind === 'province' ? routeStep.prompt : '' }
      : retreatSel
        ? { title: retreatLabel, text: retreatRouting ? 'Pick a highlighted province to retreat to' : '' }
        : buildSel
          ? { title: `Build in ${provinceName(buildSel.province)}`, text: '' }
          : removeSel
            ? { title: `Remove from ${provinceName(removeSel.territory)}?`, text: '' }
            : null

  let dismissedNotice = ''

  // ── map footer (phones): progress, next unit, submit ──────────────────────
  // The orders list in a stable order (power, then province) so edited rows don't jump.
  const byNationThenProvince = (a: AnyOrder, b: AnyOrder) =>
    a.nation.localeCompare(b.nation) || provinceName(orderSource(a)).localeCompare(provinceName(orderSource(b)))
  $: listedOrders = [...orders].sort(byNationThenProvince)
  // What the panel lists. A sandbox phase you've stepped back to reads as history: every
  // unit, an un-ordered one as the Hold it resolved as. The latest phase is entry: just the
  // entered orders, with un-ordered units under "No order yet". History lists every unit.
  $: sandboxPast = controlAll && canPhaseForward
  $: shownOrders = sandboxPast ? withImplicitHolds(orders, phase, ownUnits).sort(byNationThenProvince) : listedOrders
  $: shownHistory = withImplicitHolds(historyOrders, phase, units).sort(byNationThenProvince)
  const isEntered = (o: AnyOrder) => orders.some((x) => orderSource(x) === orderSource(o))
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
      ? { text: `${pendingRetreats.length} retreat${pendingRetreats.length === 1 ? '' : 's'} to order`, next: true }
      : pendingBuilds && buildSpots.length
        // No "Next" for builds: where to build is the choice, so don't pick a center for them.
        ? { text: `${pendingBuilds} build${pendingBuilds === 1 ? '' : 's'} available`, next: false }
        : pendingRemovals
          ? { text: `${pendingRemovals} unit${pendingRemovals === 1 ? '' : 's'} to remove`, next: true }
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
  // After editing a submitted set: how many units' orders differ from it.
  $: changedCount = [...new Set([...orders, ...submittedOrders].map(orderSource))].filter((src) => {
    const a = orders.find((o) => orderSource(o) === src)
    const b = submittedOrders.find((o) => orderSource(o) === src)
    return !a || !b || !sameOrders([a], [b])
  }).length
  $: submitLabel = onResolve ? 'Resolve' : !effectiveReady ? 'Submit' : dirtySinceSubmit ? 'Resubmit' : 'Submitted'
  const doSubmit = () => (onResolve ? onResolve(withImplicitHolds(orders, phase, ownUnits)) : submit())

  // Submitting with something left to do asks first, spelling out what the engine will do
  // in its place. Live play only — a sandbox resolves whatever is on the board.
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const names = (list: string[]) => list.join(', ')
  $: submitWarnings = onResolve || !canAct
    ? []
    : [
        unorderedUnits.length
          ? `${plural(unorderedUnits.length, 'unit')} without an order will hold: ${names(unorderedUnits.map(unitLabel))}.`
          : '',
        pendingRetreats.length
          ? `${plural(pendingRetreats.length, 'dislodged unit')} without a retreat will be disbanded: ${names(pendingRetreats.map((d) => unitLabel(d.unit)))}.`
          : '',
        pendingBuilds && buildSpots.length ? `You'll give up ${plural(pendingBuilds, 'build')} — unused builds are lost.` : '',
        pendingRemovals
          ? `${plural(pendingRemovals, 'unit')} will be removed for you, farthest from your home centers first.`
          : '',
      ].filter(Boolean)
  let confirmingSubmit = false
  // The mobile strip with nothing to say (every unit ordered, builds all placed): just the
  // Submit button, its backdrop shrunk to fit and pinned right, rather than a status bar.
  $: stripBare =
    !onResolve &&
    !pendingAdjust &&
    !(effectiveReady && dirtySinceSubmit) &&
    !amIdle &&
    !submitDone &&
    ((phase === 'movement' && !unorderedUnits.length) || (phase === 'build' && !buildPrompt))
  // Desktop with the sidebar open: a movement order's prompt and choices sit in the unit's
  // sidebar row, so the floating map hint stands down.
  $: sidebarHint = !$compact && !rightHidden && phase === 'movement'
  // Phones always, desktop while the order sidebar is hidden: next unit + Submit on the map.
  $: mapStrip = $compact || rightHidden
  const requestSubmit = () => (submitWarnings.length ? (confirmingSubmit = true) : doSubmit())
  function submitAnyway() {
    confirmingSubmit = false
    doSubmit()
  }

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
  // A selected unit is in move mode until another order type is picked: a click moves
  // there (the unit itself holds); with a mouse, right click on a unit supports it.
  $: moveMode = phase === 'movement' && !!draft && (!draft.type || (draft.type === 'Move' && !draft.convoyPath?.length))
  $: moveModeStep = moveMode && draft && draftCtx ? nextStep({ source: draft.source, sourceCoast: draft.sourceCoast, type: 'Move' }, draftCtx) : null
  // The step the map is waiting on: the default Move's, or the picked order type's.
  $: routeStep = moveMode ? moveModeStep : currentStep
  $: moveModeChoices = moveModeStep?.kind === 'province' ? moveModeStep.choices.map((c) => toDsvgId(c.id, c.coast)) : []
  $: supportable = moveMode && draftCtx ? supportAux(mapDef, draftCtx.unit, units) : []
  $: movementHighlighted = moveMode ? moveModeChoices : moveHighlighted
  $: movementSelectable = moveMode && draft
    ? [...new Set([...ownUnits.map((u) => toDsvgId(u.territory)), ...moveModeChoices, ...supportable.map((p) => toDsvgId(p)), toDsvgId(draft.source)])]
    : moveSelectable
  // Fleets already chosen for a convoy route stay marked while the route is built.
  $: convoyChain = (draft?.convoyPath ?? []).map((p) => toDsvgId(p))

  // Retreat: the dislodged units awaiting an order, or the picked one's destinations.
  $: retreatMap = retreatMapInputs(mapDef, myDislodged, orders, units, contested, retreatRouting ? retreatSel : null)
  // Build: open slots as dashed "+" rings; placed builds/removes stay clickable to undo.
  $: buildMap = buildMapInputs(buildSpots, removeChoices, orders)

  $: highlighted = readOnly ? [] : phase === 'retreat' ? retreatMap.highlighted : phase === 'build' ? [] : movementHighlighted
  $: selectable = readOnly ? [] : phase === 'retreat' ? retreatMap.selectable : phase === 'build' ? buildMap.selectable : movementSelectable
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
  // tokens, removes/disbands as red markers. Read-only history draws what the panel
  // lists (un-ordered units as holds), crossing out the orders that failed. Only a
  // resolved phase has results — a finished game's final board has no orders to draw.
  // A sandbox phase revisited with its orders unchanged is editable but keeps its results.
  $: failedSources = new Set(historyResults.filter(orderFailed).map((r) => orderSource(r.order)))
  $: cutSources = new Set(historyResults.filter(supportCut).map((r) => orderSource(r.order)))
  const withResults = (src: AnyOrder[]) =>
    toRenderOrders(src, (o) => failedSources.has(orderSource(o)), (o) => cutSources.has(orderSource(o)))
  $: renderOrders = !readOnly
    ? withResults(orders)
    : historyResults.length
      ? withResults(shownHistory)
      : toRenderOrders(historyOrders)

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
  // Sandbox, latest phase: each power's un-ordered units as its own "No order yet" group.
  $: sandboxUnordered = controlAll && canAct && phase === 'movement' && !sandboxPast
    ? ownUnits.filter((u) => !orders.some((o) => orderSource(o) === u.territory))
    : []
  $: sandboxTodos = [...new Set(sandboxUnordered.map((u) => u.nation))]
    .map((n) => {
      const list = sandboxUnordered.filter((u) => u.nation === n).sort((a, b) => provinceName(a.territory).localeCompare(provinceName(b.territory)))
      const power = { name: powerName(mapDef.powers, n), color: powerColor(mapDef.powers, n, '#888') }
      return { key: `unordered:${n}`, title: 'No order yet', count: list.length, go: 'Order', power, items: list.map((u) => ({ id: u.territory, label: unitLabel(u) })) }
    })
    .sort((a, b) => a.power.name.localeCompare(b.power.name))
  // Retreat-phase to-dos: dislodged units still without a retreat or disband, grouped
  // per power when one board commands them all.
  $: retreatTodos = !canAct || phase !== 'retreat'
    ? []
    : [...new Set(pendingRetreats.map((d) => d.unit.nation))]
        .map((n) => {
          const list = pendingRetreats.filter((d) => d.unit.nation === n).sort((a, b) => provinceName(a.unit.territory).localeCompare(provinceName(b.unit.territory)))
          const power = controlAll ? { name: powerName(mapDef.powers, n), color: powerColor(mapDef.powers, n, '#888') } : undefined
          return { key: `retreat:${n}`, title: 'No order yet', count: list.length, go: 'Retreat', power, items: list.map((d) => ({ id: d.unit.territory, label: unitLabel(d.unit) })) }
        })
        .sort((a, b) => (a.power?.name ?? '').localeCompare(b.power?.name ?? ''))
  $: todos = phase === 'retreat'
    ? retreatTodos
    : phase === 'movement' && unorderedUnits.length
    ? [{ key: 'unordered', title: effectiveReady && dirtySinceSubmit ? 'Missing from draft' : 'No order yet', count: unorderedUnits.length, go: 'Order', items: unorderedUnits.map((u) => ({ id: u.territory, label: unitLabel(u) })) }]
    : phase === 'movement' && controlAll
      ? sandboxTodos
      : adjustTodos
  // A to-do row: open that unit's / center's actions on the map.
  function pickTodo(id: string) {
    if (phase === 'movement') return pickUnit(id)
    tab = 'map'
    if (phase === 'retreat') return selectRetreat(id)
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
  // Led by the unit type ("Army Berlin → Kiel") — the plain line names what moves.
  $: describeOrder = (o: AnyOrder): string => {
    const text = describeAnyOrder(mapDef, o)
    if (o.type === 'Build' || o.type === 'Remove') return text
    const u = units.find((x) => x.territory === o.source) ?? dislodged.find((d) => d.unit.territory === o.source)?.unit
    return u ? `${u.type === 'fleet' ? 'Fleet' : 'Army'} ${text}` : text
  }
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
      <LeftRail
        {title}
        {onExit}
        {exitLabel}
        width={leftWidth}
        open={leftOpen}
        collapsed={$wideLayout && leftHidden}
        onClose={() => (leftOpen = false)}
      >
        <slot name="left" />
      </LeftRail>
    {/if}

    <div class="map-area pane" aria-hidden={$compact && tab !== 'map'}>
      {#if !$compact && hasRail && !leftShown}
        <!-- Left rail hidden (or a closed drawer): Leave stays one click away, on the map. -->
        {#if onExit}
        <div class="map-chrome">
            <button
              class="glass chrome-btn"
              on:click={onExit}
              title={exitLabel ? `Back to ${exitLabel.toLowerCase()}` : 'Exit to games'}
              aria-label={exitLabel ? `Back to ${exitLabel.toLowerCase()}` : 'Exit to games'}
            >
              <Icon name={exitLabel ? 'back' : 'exit'} strokeWidth={2.2} round />
            </button>
        </div>
        {/if}
      {/if}
      {#if !$compact}
        <!-- Edge handles: collapse / expand each sidebar from the border it sits on. -->
        {#if hasRail}
          <button
            class="edge-handle left"
            class:closed={!leftShown}
            on:click={toggleLeft}
            title={leftShown ? 'Hide sidebar ([)' : `Show ${onResolve ? 'sidebar' : 'press'} ([)`}
            aria-label={leftShown ? 'Hide left sidebar' : 'Show left sidebar'}
            aria-expanded={leftShown}
          >
            <Icon name="chevron-right" size={14} strokeWidth={2.4} round />
            {#if !leftShown && pressBadge}<span class="edge-dot" aria-label="Unread press"></span>{/if}
          </button>
        {/if}
        <button
          class="edge-handle right"
          class:closed={rightHidden}
          on:click={() => (rightHidden = !rightHidden)}
          title={rightHidden ? 'Show orders (])' : 'Hide orders (])'}
          aria-label={rightHidden ? 'Show orders sidebar' : 'Hide orders sidebar'}
          aria-expanded={!rightHidden}
        >
          <Icon name="chevron-right" size={14} strokeWidth={2.4} round />
        </button>
      {/if}
      <DiplomacyMap
        bind:this={mapRef}
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
        ringed={actionMenu}
        onBackgroundClick={canAct ? cancel : null}
        onProvinceClick={canAct ? handleProvinceClick : null}
        onProvinceAuxClick={canAct ? handleProvinceAuxClick : null}
      />

      <div class="map-action">
        {#if !$compact && rightHidden}
          <button class="glass orders-chip" on:click={() => (rightHidden = false)} title="Show orders (])" aria-label="Show orders sidebar">
            <span>{season} {year}</span>
            {#if isOrderPhase(phase)}<span class="chip-phase">{PHASE_LABEL[phase]}</span>{/if}
            {#if deadline}<span class="chip-sep">·</span><Countdown {deadline} {graceEndsAt} />{/if}
            {#if canAct && unorderedUnits.length}<span class="chip-todo">{ownUnits.length - unorderedUnits.length}/{ownUnits.length} ordered</span>{:else if submitDone}<span class="chip-done">✓ Submitted</span>{/if}
          </button>
        {/if}
        {#if !$compact}<slot name="map-action" />{/if}
      </div>


      <div class="map-foot">
        {#if notice && notice !== dismissedNotice && !(mapHint && !sidebarHint)}
          <div class="glass notice">
            <button class="notice-body" on:click={() => (tab = 'orders')}>
              <span>{notice}</span>
              {#if $compact}<span class="notice-go">Details ›</span>{/if}
            </button>
            <button class="notice-x" on:click={() => (dismissedNotice = notice)} aria-label="Dismiss">✕</button>
          </div>
        {/if}
        {#if mapHint && !sidebarHint}
          {#if actionMenu}<ActionBar items={actionMenu.items} onPick={onAction} />{/if}
          <div class="glass hint" role="status">
            <div class="hint-text">
              <strong>{mapHint.title}</strong>
              {#if mapHint.text}<span>{mapHint.text}</span>{/if}
              {#if draft && routeStep?.kind === 'province'}
                {#each choiceNotes(routeStep.choices) as [note, names]}
                  <span class="hint-note">{note}: {names}</span>
                {/each}
              {/if}
            </div>
            <button class="hint-btn" on:click={cancel} aria-label="Cancel">✕</button>
          </div>
        {:else if actionMenu}
          <ActionBar items={actionMenu.items} onPick={onAction} />
        {:else if mapStrip && canAct && isOrderPhase(phase) && !submitDone}
          <!-- Submitted: no strip (the Orders tab / chip carry the state). -->
          <div class="glass strip" class:bare={stripBare} class:done-strip={amIdle}>
            {#if !stripBare}
            <div class="strip-info">
              {#if pendingAdjust?.next}
                <button class="strip-next" on:click={nextPending}>
                  <span class="dot"></span>{pendingAdjust.text}
                  <span class="next">Next ›</span>
                </button>
              {:else if pendingAdjust}
                <span class="strip-next"><span class="dot"></span>{pendingAdjust.text}</span>
              {:else if onResolve}
                <span class="strip-count">{phase === 'movement' ? `${Math.min(orders.length, units.length)}/${units.length} ordered` : phase === 'retreat' ? '✓ Retreats ordered' : '✓ Adjustments done'}</span>
              {:else if effectiveReady && dirtySinceSubmit}
                <span class="unsent">Unsent changes</span>
              {:else if amIdle}
                <span class="strip-done">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                  <strong>Nothing to order</strong>
                </span>
              {:else if unorderedUnits.length}
                <button class="strip-go" on:click={nextUnit}>
                  <span class="dot"></span>
                  Order {provinceName(unorderedUnits[0].territory)}
                  {#if unorderedUnits.length > 1}<span class="more">+{unorderedUnits.length - 1}</span>{/if}
                  <span class="next">›</span>
                </button>
              {:else}
                <span>{phase === 'retreat' ? (myDislodged.length ? 'Tap a flagged unit to retreat it' : 'No retreats') : buildPrompt}</span>
              {/if}
            </div>
            {/if}
            {#if amIdle}
              <!-- Nothing to order: the status alone, no button. -->
            {:else}
            <button
                class="strip-submit"
                class:resubmit={!onResolve && effectiveReady && dirtySinceSubmit}
                class:incomplete={submitWarnings.length > 0 && !submitDone}
                disabled={saving}
                on:click={requestSubmit}
              >
                {submitLabel}
              </button>
            {/if}
          </div>
        {:else if mapStrip && readOnly && onPhaseLatest}
          <div class="glass strip">
            <div class="strip-info"><span>Viewing a past phase</span></div>
            <button class="strip-submit plain" on:click={onPhaseLatest}>Back to now ›</button>
          </div>
        {/if}
      </div>
    </div>

    <aside class="sidebar pane orders-pane" class:collapsed={!$compact && rightHidden} aria-hidden={$compact && tab !== 'orders'}>
      {#if !$compact}
        <PhaseHeader
          {phase}
          {season}
          {year}
          {onPhaseBack}
          {onPhaseForward}
          {canPhaseBack}
          {canPhaseForward}
        />
      {/if}

      <DeadlineBanner {deadline} {graceEndsAt} {awaiting} brief={$compact} />


      {#if $$slots.toolbar}
        <div class="side-toolbar"><slot name="toolbar" /></div>
      {/if}

      <div class="side-body">
        {#if readOnly && onPhaseLatest}
          <button class="btn latest" on:click={onPhaseLatest}>Back to the current phase ›</button>
        {/if}
        <OrderPanel
          {readOnly}
          {canAct}
          {phase}
          historyOrders={shownHistory}
          orders={shownOrders}
          entered={isEntered}
          {copyText}
          format={formatOrder}
          describe={describeOrder}
          warn={supportWarning}
          powerInfo={(n) => ({ name: powerName(mapDef.powers, n), color: powerColor(mapDef.powers, n, '#888') })}
          byPower={controlAll}
          hasDislodged={myDislodged.length > 0}
          {buildPrompt}
          {todos}
          onPickTodo={pickTodo}
          onEdit={editOrder}
          activeHint={sidebarHint ? mapHint?.text ?? '' : ''}
          submittedView={!onResolve && effectiveReady}
          ordersTitle={onResolve ? 'Your orders' : effectiveReady ? (dirtySinceSubmit ? 'Draft orders' : 'Submitted orders') : 'Draft orders'}
          ordersCount={!onResolve && !effectiveReady && phase === 'movement' ? `${ownUnits.length - unorderedUnits.length}/${ownUnits.length}` : null}
          changed={(o) => effectiveReady && dirtySinceSubmit && !submittedOrders.some((x) => sameOrders([x], [o]))}
          was={(id) => {
            const o = effectiveReady && dirtySinceSubmit ? submittedOrders.find((x) => orderSource(x) === id) : undefined
            const now = orders.find((x) => orderSource(x) === id)
            return o && !(now && sameOrders([o], [now])) ? describeAnyOrder(mapDef, o) : ''
          }}
          activeSource={draft?.source ?? retreatSel ?? buildSel?.province ?? removeSel?.territory ?? ''}
          locked={!onResolve && effectiveReady && dirtySinceSubmit ? submittedOrders : []}
          onCancel={cancel}
          onDelete={deleteOrder}
          onRevert={revertOrder}
        />

        <slot name="results" />
        <slot name="orders-extra" spotlight={(n: string | null) => (spotlightNation = n ?? '')} />
        <!-- Standings live in the orders view, never on the map. A game places them among its
             own rows (standingsInSidebar); otherwise (a sandbox) they close the sidebar. -->
        {#if !standingsInSidebar && phase !== 'lobby' && Object.keys(supplyCenters).length}
          <div class="standings">
            <SupplyCenterCard powers={mapDef.powers} {supplyCenters} {nation} onHover={(n) => (spotlightNation = n ?? '')} />
          </div>
        {/if}

      </div>

      {#if canAct && isOrderPhase(phase)}
        <!-- Pinned to the sidebar's foot so Submit never scrolls away. -->
        <div class="side-foot">
          <SubmitControls
            sandbox={Boolean(onResolve)}
            idle={amIdle}
            {saving}
            ready={effectiveReady}
            dirty={dirtySinceSubmit}
            resubmitted={hasResubmitted}
            error={saveError}
            incomplete={submitWarnings.length > 0}
            onSubmit={requestSubmit}
          />
        </div>
      {/if}
    </aside>
  </div>

  {#if $compact}
    <GameTabs
      {tab}
      onSelect={(t) => (tab = t)}
      {pressBadge}
      ordersBadge={unorderedUnits.length}
      ordersDone={submitDone && !amIdle}
      ordersDirty={!onResolve && effectiveReady && dirtySinceSubmit ? changedCount : 0}
    />
  {/if}
</div>

{#if confirmingSubmit}
  <Modal title="Submit with orders missing?" onClose={() => (confirmingSubmit = false)} top="max(48px, 18vh)">
    <ul class="submit-warnings">
      {#each submitWarnings as w (w)}<li>{w}</li>{/each}
    </ul>
    <div class="submit-confirm">
      <button class="btn btn-primary anyway" on:click={submitAnyway}>Submit anyway</button>
      <button class="btn btn-ghost" on:click={() => (confirmingSubmit = false)}>Keep ordering</button>
    </div>
  </Modal>
{/if}

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

  .sidebar.collapsed {
    display: none;
  }

  /* Top-left of the map while the left rail is hidden: Leave, show-sidebar, game name.
     The supply-center card moves down below it. */
  .map-chrome {
    position: absolute;
    top: 14px;
    left: 14px;
    right: 80px;
    z-index: 16;
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .map-chrome > * {
    pointer-events: auto;
  }
  .chrome-btn {
    position: relative;
    flex: none;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 50%;
    color: var(--text);
    cursor: pointer;
  }
  .chrome-btn:hover,
  .orders-chip:hover {
    border-color: var(--border-strong);
  }
  /* A tab on the map's edge against each sidebar: ‹ collapses it, › brings it back (the
     chevron points the way the panel will move). Same spot in both states. */
  .edge-handle {
    position: absolute;
    top: 50%;
    z-index: 17;
    width: 18px;
    height: 56px;
    margin-top: -28px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-secondary);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
    cursor: pointer;
  }
  .edge-handle:hover {
    color: var(--accent);
    background: var(--bg-elevated);
  }
  .edge-handle.left {
    left: 0;
    border-left: none;
    border-radius: 0 10px 10px 0;
  }
  .edge-handle.right {
    right: 0;
    border-right: none;
    border-radius: 10px 0 0 10px;
  }
  /* Open: point outward (collapse); closed: point inward (expand). */
  .edge-handle.left:not(.closed) :global(svg),
  .edge-handle.right.closed :global(svg) {
    transform: rotate(180deg);
  }
  .edge-dot {
    position: absolute;
    top: 6px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  /* Right sidebar hidden: the phase, unordered-unit count and a way back to it. */
  .orders-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 12px 0 16px;
    border-radius: var(--radius-full);
    color: var(--text);
    font: 600 14px var(--font);
    cursor: pointer;
  }
  .chip-sep {
    color: var(--text-tertiary);
  }
  .chip-todo {
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: var(--amber-subtle);
    color: var(--amber);
    font-size: 12px;
    font-weight: 700;
  }
  .chip-done {
    color: var(--green);
    font-size: 12px;
    font-weight: 700;
  }
  .chip-phase {
    color: var(--text-secondary);
    font-weight: 500;
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
  .side-foot {
    position: sticky;
    bottom: 0;
    z-index: 20;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-card);
  }
  .compact .side-foot {
    padding: 10px 16px 12px;
    background: var(--bg);
  }
  /* Same quiet hairline row as the game's Sandbox / End the game rows. */
  .standings {
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
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

  /* Bottom of the map: the action bar over the routing hint, or (phones) next unit + submit. */
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
  /* A slim floater sized to its content and centred: status / next unit as text, one
     button (Submit, Resubmit, …) on the right. */
  .strip {
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 100%;
    padding: 6px 6px 6px 16px;
    border-radius: 16px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  }
  /* Nothing to press (nothing to order): just the status. */
  .strip.done-strip:not(:has(button)) {
    min-height: 52px;
    padding: 6px 18px;
  }
  .strip.bare {
    padding: 6px;
  }
  .strip-info {
    flex: 0 1 auto;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .strip-info .unsent {
    color: var(--accent);
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
  .submit-warnings {
    margin: 0 0 16px;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text-secondary);
  }
  .submit-confirm {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Amber like the Submit button it confirms (orders still missing). */
  .submit-confirm .anyway,
  .submit-confirm .anyway:hover:not(:disabled) {
    background: var(--amber);
    border-color: var(--amber);
    color: #fff;
  }
  .submit-confirm .btn {
    min-height: 46px;
    font-size: 15px;
  }
  span.strip-next {
    cursor: default;
  }
  .strip-next .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--amber);
    flex: none;
  }
  .strip-go {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    height: 40px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: 700 15px var(--font);
    white-space: nowrap;
    cursor: pointer;
  }
  .strip-go:hover .next {
    color: var(--accent);
  }
  .strip-go .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--amber);
  }
  .strip-go .more {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .strip-go .next {
    color: inherit;
    font-size: 16px;
  }
  .strip-count {
    color: var(--text);
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .strip-done {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--green);
  }
  .strip-done svg {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .strip-done strong {
    color: var(--text);
    font-size: 14px;
  }
  .strip-next .next {
    color: var(--accent);
    font-weight: 700;
  }
  .strip-submit {
    flex: none;
    height: 40px;
    padding: 0 18px;
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
  /* Something still to order: yellow until it's all in (submitting asks first). */
  .strip-submit.incomplete {
    background: var(--amber);
  }
  .strip-submit.plain {
    background: var(--accent);
  }
  .strip-submit:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
