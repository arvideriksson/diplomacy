// The viewer's order set for the round on the board, and everything that keeps it safe:
// loading the saved row, the device backup of unsent edits, the debounced draft
// autosave, and submit / resubmit. The board drives the UI from these stores and routes
// every user edit through `edit`.
//
//   Phase 1 (not ready): edits autosave as a draft (silently, debounced) and are backed
//   up on the device until the server has them.
//   Phase 2 (ready): edits live only here until Resubmit — backed up on the device and
//   flagged `dirtySinceSubmit`, never written to the server row.
//
// A failed load must not look like "no orders": an edit would then autosave the
// near-empty set over the saved one. Until a load succeeds, the server row is never
// written (no autosave, no submit) and the load retries with backoff.
import { get, writable } from 'svelte/store'
import type { Unit } from '../game'
import type { AnyOrder } from './types'
import { fetchMyOrders, saveDraftOrders, submitOrders } from './api'
import { readDraftBackup, writeDraftBackup, sameOrders } from '../draftBackup'
import { createDebouncer } from '../debounce'
import { errorMessage } from '../errors'
import { isOrderPhase } from '../phases'
import { withImplicitHolds } from './board'

export interface SessionRound {
  gameId: string
  nation: string
  year: number
  season: string
  phase: string
}

export interface OrderSessionOptions {
  /** The round on the board, read at call time (the board's current props). */
  round: () => SessionRound
  /** The server's ready flag for this nation (the `ready` prop), read at call time. */
  ready: () => boolean
  /** The units the viewer orders (un-ordered ones become explicit Holds on submit). */
  ownUnits: () => Unit[]
  /** Live play persists to the server; a sandbox / history board keeps orders local. */
  persist: () => boolean
  /** Notified with the order set on load and on every edit. */
  onChange?: (orders: AnyOrder[]) => void
  draftDebounceMs?: number
}

export const DRAFT_DEBOUNCE_MS = 750
const RETRY_MAX_MS = 30_000
const retryDelay = (attempt: number) => Math.min(RETRY_MAX_MS, 2000 * 2 ** attempt)

export function createOrderSession(opts: OrderSessionOptions) {
  const orders = writable<AnyOrder[]>([])
  // Snapshot of the orders actually locked in on the server (the submitted set). Drives
  // the read-only "locked in" box; survives Phase 2 edits so it shows the committed
  // truth, not the live draft. Empty until this nation has readied.
  const submittedOrders = writable<AnyOrder[]>([])
  // Edits made after submitting (Phase 2) are ephemeral until Resubmit — flag them.
  const dirtySinceSubmit = writable(false)
  // Optimistic ready state: submit flips the UI immediately instead of waiting for
  // `ready` to round-trip back through the parent's realtime subscription. Cleared once
  // the prop catches up (syncReady) or on round change.
  const readyOverride = writable<boolean | null>(null)
  // True only after the user clicks Resubmit *in this view* (drives Submitted vs
  // Resubmitted). Reset on every load — on entry we can't tell submit from resubmit,
  // so an already-submitted game always reads as the calm "Submitted".
  const hasResubmitted = writable(false)
  const saving = writable(false)
  const saveError = writable('')
  const loadFailed = writable(false)

  // Bumped on every round change: async work started for an older round is dropped.
  let token = 0
  let loadRetry: ReturnType<typeof setTimeout> | null = null

  const isReady = () => get(readyOverride) ?? opts.ready()
  const persisting = () => opts.persist()

  // Device backup of unsent orders (see draftBackup.ts): an unsaved draft, or edits to a
  // submitted set. Restored on the next load instead of being lost.
  const writeBackup = (set: AnyOrder[] | null) => writeDraftBackup(opts.round(), set)
  const readBackup = () => readDraftBackup(opts.round())

  // Live autosave of the unsubmitted draft (Phase 1, !ready); silent, no status UI.
  // A pending save is dropped (not flushed) on round change and submit, but flushed when
  // the view goes away or the page is hidden — phones leave fast (back, app switch).
  const draftSave = createDebouncer(() => saveDraftNow(), opts.draftDebounceMs ?? DRAFT_DEBOUNCE_MS)

  function clearRetry() {
    if (loadRetry) clearTimeout(loadRetry)
    loadRetry = null
  }

  // One row per round holds the orders whether drafted or submitted (readiness is the
  // `ready` prop, from games.ready) — so load it directly; no draft/submitted branching.
  async function load(attempt = 0) {
    hasResubmitted.set(false)
    clearRetry()
    const t = token
    const { gameId, year, season, phase } = opts.round()
    let loaded: AnyOrder[]
    try {
      loaded = await fetchMyOrders(gameId, year, season, phase)
    } catch {
      if (t !== token) return
      loadFailed.set(true)
      orders.set(readBackup() ?? [])
      saveError.set("Couldn't load your orders — retrying…")
      loadRetry = setTimeout(() => t === token && load(attempt + 1), retryDelay(attempt))
      return
    }
    if (t !== token) return // the round moved on while this was in flight
    if (get(loadFailed)) saveError.set('')
    loadFailed.set(false)
    orders.set(loaded)
    // If the nation is already ready, the loaded set IS the locked-in set; otherwise
    // it's an unsubmitted draft and nothing is locked in yet.
    const submitted = isReady() ? [...loaded] : []
    submittedOrders.set(submitted)
    const backup = readBackup()
    if (backup && isReady() && !sameOrders(backup, submitted)) {
      orders.set(backup) // unsent edits to the submitted set
      dirtySinceSubmit.set(true)
    } else if (backup) {
      orders.set(backup)
      draftSave.schedule()
    } else writeBackup(null)
    opts.onChange?.(get(orders))
  }

  /**
   * The round on the board changed: reset, then load this nation's saved row (live) or
   * start from `preset` (sandbox). A pending autosave is dropped, not flushed.
   */
  function enterRound(preset: AnyOrder[] | null) {
    token++
    clearRetry()
    dirtySinceSubmit.set(false)
    readyOverride.set(null)
    hasResubmitted.set(false)
    submittedOrders.set([]) // load() repopulates it for an already-ready nation
    saveError.set('') // clear any "catching up…" notice once the new round arrives
    loadFailed.set(false)
    draftSave.cancel()
    const { gameId, nation, phase } = opts.round()
    if (!persisting()) orders.set(preset ?? []) // sandbox: preset
    else if (gameId && nation && isOrderPhase(phase)) load() // live: reload saved
    else orders.set([])
    if (persisting()) opts.onChange?.(get(orders))
  }

  // Debounced autosave of the unsubmitted draft. No-op in sandbox, once ready, or
  // outside an order phase — those never write a draft.
  function scheduleDraftSave() {
    const { gameId, nation, phase } = opts.round()
    if (!persisting() || isReady() || !gameId || !nation || !isOrderPhase(phase)) return
    writeBackup(get(orders))
    if (get(loadFailed)) return // kept on this device only until the saved set loads
    draftSave.schedule()
  }

  async function saveDraftNow() {
    if (isReady() || get(loadFailed)) return
    const sent = get(orders)
    const { gameId, year, season, phase } = opts.round()
    try {
      await saveDraftOrders(gameId, sent, { year, season, phase })
      if (sent === get(orders)) writeBackup(null)
    } catch {
      // silent: a dropped autosave just retries on the next edit
    }
  }

  // Notify the parent of a change (sandbox stores it / forks the timeline) and, in live
  // play, persist it: autosave the draft while unsubmitted, or just flag unsaved edits
  // once submitted (Phase 2 edits don't persist until Resubmit).
  function notify() {
    const now = get(orders)
    opts.onChange?.(now)
    if (!persisting()) return // sandbox: no server persistence
    if (isReady()) {
      // Unsent edits to a submitted set live only here until Resubmit — back them up so
      // leaving doesn't silently drop them; they come back flagged on the next load.
      // Only a real difference counts: putting the submitted order back is no change.
      const dirty = !sameOrders(now, get(submittedOrders))
      dirtySinceSubmit.set(dirty)
      const { gameId, nation } = opts.round()
      if (gameId && nation) writeBackup(dirty ? now : null)
    } else scheduleDraftSave()
  }

  /** A user edit: replace the order set, notify and persist. */
  function edit(next: AnyOrder[]) {
    orders.set(next)
    notify()
  }

  // Submit (or resubmit): the orders row becomes the only persisted truth and the
  // draft is dropped server-side. Cancels any pending autosave and clears dirty.
  async function submit() {
    const { gameId, nation, year, season, phase } = opts.round()
    if (!gameId || !nation || get(loadFailed)) return
    saving.set(true)
    saveError.set('')
    draftSave.cancel()
    const wasReady = isReady() // a commit while already submitted is a *re*submit
    const committed = withImplicitHolds(get(orders), phase, opts.ownUnits()) // un-ordered units become explicit Holds
    try {
      await submitOrders(gameId, committed, { year, season, phase })
      readyOverride.set(true)
      submittedOrders.set([...committed]) // the just-committed set is now locked in
      orders.set(committed) // reflect the filled-in holds in the live, editable list too
      notify() // ready + identical to the locked-in set: clears the backup
      dirtySinceSubmit.set(false)
      hasResubmitted.set(wasReady)
    } catch (e) {
      const msg = errorMessage(e)
      // The round resolved between load and submit (instant early resolution + the brief
      // realtime-propagation lag). The incoming snapshot will advance us in a moment, so
      // show a soft "catching up" notice rather than a hard error; it clears on round change.
      saveError.set(msg.includes('Round has advanced') ? 'That round just resolved — catching up…' : msg)
    } finally {
      saving.set(false)
    }
  }

  /** The `ready` prop changed (or the override did): drop the override once it agrees. */
  function syncReady(ready: boolean) {
    const o = get(readyOverride)
    if (o !== null && ready === o) readyOverride.set(null)
  }

  const flush = () => draftSave.flush()
  const onHidden = () => document.visibilityState === 'hidden' && flush()
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
  }

  /** The board went away: stop retrying, flush a pending autosave, detach listeners. */
  function destroy() {
    clearRetry()
    flush()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }

  return {
    orders,
    submittedOrders,
    dirtySinceSubmit,
    readyOverride,
    hasResubmitted,
    saving,
    saveError,
    loadFailed,
    isReady,
    enterRound,
    edit,
    submit,
    syncReady,
    flush,
    destroy,
  }
}

export type OrderSession = ReturnType<typeof createOrderSession>
