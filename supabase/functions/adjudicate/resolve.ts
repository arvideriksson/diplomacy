// Orchestrates one resolution: load → run the pure engine → commit atomically.
// All game-advancing logic that isn't pure adjudication lives here; the rules
// themselves are entirely in engine/.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
// Values come from the pre-bundled engine (run `npm run build:edge`); the bundle
// is self-contained so there is no cross-boundary or extensionless resolution.
import { adjudicate, boardFromUnits, getMap } from './_engine.mjs'
import { getGame, getRoundOrders, type GameRow } from './db.ts'

// The engine's BoardState/AnyOrder, kept loose here — this file only threads them.
type BoardState = { phase: string; season: string; year: number; units: unknown[] }
type AnyOrder = unknown

const ORDER_PHASES = ['movement', 'retreat', 'build']

const TIMER_MS: Record<string, number> = {
  '12h': 12 * 3600_000,
  '24h': 24 * 3600_000,
  '48h': 48 * 3600_000,
  '72h': 72 * 3600_000,
  '1w': 7 * 24 * 3600_000,
}

function deadlineFor(game: GameRow, nowMs: number): string {
  const ms = TIMER_MS[game.settings?.turn_timer ?? '24h'] ?? TIMER_MS['24h']
  return new Date(nowMs + ms).toISOString()
}

/** Board going into resolution: the stored snapshot, or a fresh board for turn 1. */
function loadBoard(game: GameRow): BoardState {
  if (game.snapshot) return game.snapshot as BoardState
  const map = getMap(game.map_id)
  return boardFromUnits(map, game.units as never[], game.year, game.season, game.phase as never)
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
  const orders: AnyOrder[] = orderRows
    .filter((r) => ready[r.nation] === true)
    .flatMap((r) => (r.orders as AnyOrder[]) ?? [])

  const { newBoardState, victory } = adjudicate(map, board, orders)

  const complete = Boolean(victory)
  const next = complete
    ? { phase: 'complete', season: newBoardState.season, year: newBoardState.year }
    : { phase: newBoardState.phase, season: newBoardState.season, year: newBoardState.year }

  const { error } = await db.rpc('apply_resolution', {
    p_game_id: gameId,
    p_round: { year: game.year, season: game.season, phase: game.phase },
    p_snapshot: newBoardState,
    p_units: newBoardState.units,
    p_next: next,
    p_deadline: complete ? null : deadlineFor(game, nowMs),
  })
  if (error) throw error

  return { status: 'resolved', next }
}
