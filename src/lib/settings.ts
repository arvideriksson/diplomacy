// Game settings (games.settings): the shape and the defaults. Pure — no client — so the
// SQL parity tests can import it. The SQL restates the defaults; sqlParity.test.ts checks them.
import type { Phase } from './phases'

/** Per-phase auto-resolve durations, in minutes. */
export interface PhaseTimers {
  movement: number
  retreat: number
  build: number
}

export type OrderPhase = Phase

export interface GameSettings {
  /** No press: players cannot send chat / negotiate. The map is chosen via `map_id`. */
  gunboat: boolean
  random_nations: boolean
  /** Resolve as soon as every power has submitted, rather than only at the deadline. */
  early_resolution: boolean
  /** How long each phase lasts before its deadline (minutes); unready powers then get a grace period. */
  phase_timers: PhaseTimers
  /**
   * The creator gets an in-game admin menu (revert, force-resolve, deadline and pacing
   * changes). Private games only; editable in the lobby, fixed once the game starts.
   */
  host_controls?: boolean
  /**
   * How long (minutes) a phase waits past its deadline for unsubmitted powers before
   * resolving without them (0 = no grace). Absent/null = one movement timer.
   */
  grace_period?: number | null
  /** Length (minutes) of the game's first phase, for opening negotiations. Absent/null = the movement timer. */
  first_turn?: number | null
  /** Legacy single-timer enum; read only as a fallback when phase_timers is absent. */
  turn_timer?: '12h' | '24h' | '48h' | '72h' | '1w'
}

export const DEFAULT_SETTINGS: GameSettings = {
  gunboat: false,
  random_nations: false,
  early_resolution: true,
  phase_timers: { movement: 1440, retreat: 720, build: 720 }, // 24h / 12h / 12h
}
