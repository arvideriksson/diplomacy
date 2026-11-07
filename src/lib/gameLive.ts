// A game's live subscription: its private Broadcast topic, the viewer's readiness
// alongside each row, and the deadline timer that opens the grace period.
import { keepJoined, type LiveTopic } from './liveTopic'
import { isOrderPhase } from './phases'
import {
  currentGame,
  fetchGame,
  fetchGameIfNewer,
  fetchReadiness,
  tryReadiness,
  withReadiness,
  type GameState,
} from './game'

/** Per subscribed game: re-read the viewer's readiness (after a submit). */
const readinessRefresh = new Map<string, () => void>()

/** Re-read the viewer's readiness for a subscribed game — nothing broadcasts a ready
 *  flag, so a submit asks for its own. No-op when the game isn't subscribed. */
export const refreshReadiness = (gameId: string): void => readinessRefresh.get(gameId)?.()

/**
 * Live updates for a game over its private Broadcast topic `game:<id>` (see the
 * egress_cuts and hide_readiness migrations): the full row (without `ready`) when the
 * game changed, and during a grace period a {waiting} list when someone readies.
 * Readiness is never broadcast otherwise, so the viewer's own flag is read with each
 * full row, after their own submit, and when the deadline passes (the grace period
 * starts without any write to broadcast). Broadcast reaches online subscribers only,
 * so every (re)join reads the row back — but only if it changed after the last full
 * row this subscription saw.
 */
export function subscribeToGame(
  id: string,
  current: () => GameState | null,
  onChange: (game: GameState) => void,
): LiveTopic {
  let fullSince = current()?.updated_at ?? ''
  let stopped = false
  // A read that started before a broadcast can land after it: never step backwards.
  const stale = (at: string) => {
    const now = current()?.updated_at
    return !!now && at < now
  }
  const publish = (g: GameState) => {
    currentGame.set(g)
    onChange(g)
    armDeadline(g)
  }
  const full = (g: GameState) => {
    if (stopped || stale(g.updated_at)) return
    fullSince = g.updated_at
    publish(g)
  }
  // Merge a fresh readiness read into whatever the game is now.
  const refresh = () => {
    fetchReadiness(id)
      .then((r) => {
        const g = current()
        if (!stopped && g) publish(withReadiness(g, r))
      })
      .catch(() => {})
  }
  readinessRefresh.set(id, refresh)

  // The grace period begins when the deadline passes; nothing is written then, so
  // nothing is broadcast — read who it's waiting on at that moment.
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null
  let armedFor: string | null = null
  function armDeadline(g: GameState) {
    const at = g.deadline && isOrderPhase(g.phase) ? Date.parse(g.deadline) : NaN
    const key = Number.isFinite(at) ? g.deadline! : null
    if (key === armedFor) return
    if (deadlineTimer) clearTimeout(deadlineTimer)
    deadlineTimer = null
    armedFor = key
    const ms = at - Date.now()
    // Timers past ~24 days overflow; a game that far out re-arms on its next update.
    if (key && ms > 0 && ms < 2 ** 31 - 1) deadlineTimer = setTimeout(refresh, ms + 1000)
  }
  const initial = current()
  if (initial) armDeadline(initial)

  const topic = keepJoined(
    `game:${id}`,
    {
      // The row arrives without `ready`; read the viewer's own flag to go with it.
      game: (p) => {
        const g = p as GameState
        tryReadiness(id).then((r) => full(withReadiness(g, r)))
      },
      waiting: (p) => {
        const g = current()
        if (stopped || !g) return
        const { waiting } = p as { waiting: string[] }
        const mine = Object.keys(g.ready ?? {})[0]
        publish({ ...g, waiting, ready: mine ? { [mine]: !waiting.includes(mine) } : {} })
      },
    },
    () => {
      if (fullSince) {
        // Unchanged row: still re-read readiness (it may have moved while away).
        fetchGameIfNewer(id, fullSince)
          .then((g) => (g ? full(g) : refresh()))
          .catch(() => {})
      } else {
        fetchGame(id).then(full).catch(() => {})
      }
    },
  )
  return {
    ...topic,
    stop() {
      stopped = true
      if (deadlineTimer) clearTimeout(deadlineTimer)
      if (readinessRefresh.get(id) === refresh) readinessRefresh.delete(id)
      topic.stop()
    },
  }
}
