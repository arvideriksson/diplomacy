// Game phases. The engine resolves three order phases; a game row additionally passes
// through the lobby before play and ends complete (see the games.phase check in the
// schema migration).
import type { Phase } from './adjudicator/types'

export type { Phase }

/** Every value `games.phase` can hold. */
export type GamePhase = 'lobby' | Phase | 'resolved' | 'complete'

/** The phases in which players enter orders, in resolution order. */
export const ORDER_PHASES: readonly Phase[] = ['movement', 'retreat', 'build']

/** Whether a game is in an order phase (i.e. in play, not lobby or complete). */
export const isOrderPhase = (p: string | null | undefined): p is Phase =>
  (ORDER_PHASES as readonly string[]).includes(p ?? '')

/** Human label for each order phase. */
export const PHASE_LABEL: Record<Phase, string> = {
  movement: 'Movement',
  retreat: 'Retreat',
  build: 'Build',
}

/** An order phase's label, or the raw phase for any other. */
export const phaseLabel = (p: string): string => (isOrderPhase(p) ? PHASE_LABEL[p] : p)

export interface Round {
  season: string
  year: number
  phase: string
}

/** The season a round is shown under: builds read "Winter" (they're stored under Fall). */
export const roundSeason = (r: Pick<Round, 'season' | 'phase'>): string => (r.phase === 'build' ? 'Winter' : r.season)

/** "Fall 1903 · Movement", "Winter 1903 · Build"; `phaseText` replaces the phase part. */
export const roundLabel = (r: Round, phaseText: string = phaseLabel(r.phase)): string =>
  `${roundSeason(r)} ${r.year} · ${phaseText}`
