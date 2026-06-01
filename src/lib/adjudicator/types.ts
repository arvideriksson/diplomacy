// Public types for the adjudicator engine. Pure data — no runtime imports beyond
// the zero-dependency shared types and map/order type-only imports.

import type { Unit } from '../types'
import type { Order } from '../orders/types'

export type Season = 'Spring' | 'Fall'
export type Phase = 'movement' | 'retreat' | 'build'

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

// ── Order kinds the existing movement `Order` doesn't cover ──────────────────

export interface RetreatOrder {
  type: 'Retreat' | 'Disband'
  nation: string
  source: string
  sourceCoast?: string
  /** Destination (required for 'Retreat'). */
  target?: string
  targetCoast?: string
}

export interface BuildOrder {
  type: 'Build' | 'Remove'
  nation: string
  /** Home SC for Build; occupied province for Remove. */
  source: string
  sourceCoast?: string
  /** Required for Build. */
  unitType?: 'army' | 'fleet'
}

export type AnyOrder = Order | RetreatOrder | BuildOrder

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
