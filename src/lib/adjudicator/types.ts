// Public types for the adjudicator engine. Pure data — no runtime imports beyond
// the zero-dependency shared types and map/order type-only imports.

import type { Unit } from '../types'

export type Season = 'Spring' | 'Fall'
export type Phase = 'movement' | 'retreat' | 'build'

/** Identifies one round of a game: the (year, season, phase) a set of orders belongs to. */
export interface RoundKey {
  year: number
  season: Season
  phase: Phase
}

/** A unit dislodged during a movement phase; must retreat or disband. */
export interface DislodgedUnit {
  unit: Unit
  /** Province the dislodging attack came from — an illegal retreat target. */
  attackedFrom: string
}

/**
 * The complete board the engine folds over. Authoritative game state is the
 * result of replaying `adjudicate` across the resolved-order log.
 */
export interface BoardState {
  mapId: string
  year: number
  season: Season
  phase: Phase
  /** Units on the board, canonically sorted by territory. */
  units: Unit[]
  /** Supply-center ownership: province id -> owning nation (absent = neutral). */
  supplyCenters: Record<string, string>
  /** Units awaiting retreat (only populated when phase === 'retreat'). */
  dislodged: DislodgedUnit[]
  /** Standoff squares from the just-resolved movement — no retreat allowed in. */
  contested: string[]
}

// Retreat/build order kinds live with the other order types (entry-time concepts).
import type { AnyOrder } from '../orders/types'
export type { RetreatOrder, BuildOrder, AnyOrder } from '../orders/types'

// ── Results ──────────────────────────────────────────────────────────────────

export type ResultCode =
  | 'succeeds'
  | 'fails'
  | 'void' // illegal/unmatched order; treated as a hold, reported separately
  | 'dislodged'
  | 'bounced'
  | 'disbanded'

export interface OrderResult {
  order: AnyOrder
  code: ResultCode
  reason: string
}

export interface AdjudicationResult {
  newBoardState: BoardState
  results: OrderResult[]
  /** True once a power controls a winning majority of supply centers. */
  victory?: { nation: string; centers: number }
}
