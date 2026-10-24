// Orchestrates one resolution: load → run the pure engine → commit atomically.
// All game-advancing logic that isn't pure adjudication lives here; the rules
// themselves are entirely in engine/.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
// Values come from the pre-bundled engine (run `npm run build:edge`); the bundle
// is self-contained so there is no cross-boundary or extensionless resolution.
import { adjudicate, initialBoard, getMap, idleNations, replayLog, roundRank } from './_engine.mjs'
import { getGame, getResolvedLog, getRoundOrders, type GameRow } from './db.ts'

// The engine's BoardState/AnyOrder, kept loose here — this file only threads them.
type BoardState = { phase: string; season: string; year: number; units: unknown[] }
type AnyOrder = unknown
export type RoundKey = { year: number; season: string; phase: string }

const ORDER_PHASES = ['movement', 'retreat', 'build']

// Legacy single-timer enum → minutes, for games created before per-phase timers.
const LEGACY_TIMER_MIN: Record<string, number> = {
  '12h': 720,
  '24h': 1440,
  '48h': 2880,
  '72h': 4320,
  '1w': 10080,
}

// Minutes for the phase being opened. Mirrors phaseTimerMinutes() in src/lib/game.ts
// (duplicated here because Deno can't import the browser module). Prefers structured
// per-phase timers; falls back to the legacy turn_timer or a 24h default.
function phaseTimerMinutes(settings: GameRow['settings'], phase: string): number {
  const s = settings as { phase_timers?: Record<string, number>; turn_timer?: string } | undefined
  const perPhase = s?.phase_timers?.[phase]
  if (typeof perPhase === 'number' && perPhase > 0) return perPhase
  const legacy = s?.turn_timer ? LEGACY_TIMER_MIN[s.turn_timer] : undefined
  return legacy ?? LEGACY_TIMER_MIN['24h']
}

function deadlineFor(game: GameRow, nextPhase: string, nowMs: number): string {
  return new Date(nowMs + phaseTimerMinutes(game.settings, nextPhase) * 60_000).toISOString()
}

/** Board going into resolution: the stored snapshot, or the opening board for turn 1
 * (a null snapshot only occurs before the first resolution). */
function loadBoard(game: GameRow): BoardState {
  if (game.snapshot) return game.snapshot as BoardState
  return initialBoard(getMap(game.map_id)) as BoardState
}

export async function resolveGame(
  db: SupabaseClient,
  gameId: string,
  nowMs: number,
): Promise<{ status: string; next?: unknown }> {
  const game = await getGame(db, gameId)
  if (!game) return { status: 'game-not-found' }

  // Idempotency guard: only resolve a game actually claimed for an order phase.
  if (!game.resolving_at || !ORDER_PHASES.includes(game.phase)) {
    return { status: 'skipped' }
  }

  const map = getMap(game.map_id)
  const board = loadBoard(game)
  // Single-row model: a nation's orders count only if it submitted (games.ready). An
  // unsubmitted draft row is present but inert — its units hold.
  const ready = game.ready ?? {}
  const orderRows = await getRoundOrders(db, gameId, game.year, game.season, game.phase)
  // A row may only order its own nation's units: the `nation` inside each order is
  // client-supplied, so it is overwritten with the row's (RLS-verified) nation. An
  // order naming another power's unit then voids instead of commanding it.
  const orders: AnyOrder[] = orderRows
    .filter((r) => ready[r.nation] === true)
    .flatMap((r) => ((r.orders as AnyOrder[]) ?? []).map((o) => ({ ...o, nation: r.nation })))

  const { newBoardState, victory } = adjudicate(map, board, orders)

  const complete = Boolean(victory)
  const next = complete
    ? { phase: 'complete', season: newBoardState.season, year: newBoardState.year }
    : { phase: newBoardState.phase, season: newBoardState.season, year: newBoardState.year }

  // Auto-ready nations with nothing to do in the opening phase, so they don't block
  // early resolution (a build phase only the leader acts in still resolves the moment
  // that leader submits). Empty when the game is complete.
  const readyInit: Record<string, boolean> = {}
  if (!complete) for (const n of idleNations(map, newBoardState)) readyInit[n] = true

  const { error } = await db.rpc('apply_resolution', {
    p_game_id: gameId,
    p_round: { year: game.year, season: game.season, phase: game.phase },
    p_snapshot: newBoardState,
    p_next: next,
    p_deadline: complete ? null : deadlineFor(game, next.phase as string, nowMs),
    p_ready_init: readyInit,
  })
  if (error) throw error

  return { status: 'resolved', next }
}

/**
 * Roll a game back to the start of an earlier round: replay the resolved log up to
 * `target` and commit that board via apply_revert, which erases the later rounds and
 * reopens the target round's orders as drafts. Requested by the host (host_revert_to),
 * which validated the request and claimed the game.
 */
export async function revertGame(
  db: SupabaseClient,
  gameId: string,
  target: RoundKey,
  nowMs: number,
): Promise<{ status: string; round?: RoundKey }> {
  const game = await getGame(db, gameId)
  if (!game) return { status: 'game-not-found' }
  if (!game.resolving_at || !target) return { status: 'skipped' }

  const map = getMap(game.map_id)
  // Replay up to the live round so trailing phases that left no log rows (everyone
  // held) are reconstructed too — the client's history list includes them.
  const until = ORDER_PHASES.includes(game.phase)
    ? { year: game.year, season: game.season, phase: game.phase }
    : undefined
  const frames = replayLog(map, initialBoard(map), await getResolvedLog(db, gameId), until) as {
    board: BoardState
  }[]
  // Only a frame strictly before the last one is a past round (the last is the board
  // after the final resolution, i.e. the live phase).
  const frame = frames
    .slice(0, -1)
    .find((f) => roundRank(f.board) === roundRank(target))
  if (!frame) throw new Error(`no resolved round ${target.season} ${target.year} ${target.phase}`)

  const readyInit: Record<string, boolean> = {}
  for (const n of idleNations(map, frame.board)) readyInit[n] = true

  const { error } = await db.rpc('apply_revert', {
    p_game_id: gameId,
    p_round: { year: target.year, season: target.season, phase: target.phase },
    p_snapshot: frame.board,
    p_deadline: deadlineFor(game, target.phase, nowMs),
    p_ready_init: readyInit,
  })
  if (error) throw error

  return { status: 'reverted', round: target }
}
