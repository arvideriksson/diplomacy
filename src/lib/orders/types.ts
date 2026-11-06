import type { Unit } from '../types'

export type OrderType = 'Hold' | 'Move' | 'Support' | 'Convoy'

/** A single player order, expressed in game-space province ids. */
export interface Order {
  type: OrderType
  nation: string
  /** The ordered unit's province. */
  source: string
  sourceCoast?: string
  /** Destination (Move) / supported-or-convoyed destination (Support/Convoy). */
  target?: string
  /** Chosen landing coast for a Move into a multi-coast province. */
  targetCoast?: string
  /** The province of the unit being supported or convoyed. */
  aux?: string
  /**
   * Move ordered explicitly "via convoy". The move then uses *only* the convoy
   * route: if no convoy path survives it fails outright, never falling back to an
   * adjacent land move. (Move orders only.)
   */
  viaConvoy?: boolean
}

/** A retreat-phase order for a dislodged unit. */
export interface RetreatOrder {
  type: 'Retreat' | 'Disband'
  nation: string
  source: string
  sourceCoast?: string
  /** Destination (required for 'Retreat'). */
  target?: string
  targetCoast?: string
}

/** A build-phase adjustment order. */
export interface BuildOrder {
  /** Convert switches a unit's type in place (VariantRules.conversion). */
  type: 'Build' | 'Remove' | 'Convert'
  nation: string
  /** Home SC for Build; the unit's province for Remove and Convert. */
  source: string
  /** The coast of a fleet built or converted on a multi-coast province. */
  sourceCoast?: string
  /** The unit type to build, or to convert into. Required for Build and Convert. */
  unitType?: 'army' | 'fleet'
}

/** Any order across all phases. */
export type AnyOrder = Order | RetreatOrder | BuildOrder

/** A unit identified by where it stands — what the wizard operates on. */
export interface OrderableUnit {
  unit: Unit
  source: string
  sourceCoast?: string
}

export const unitKey = (u: Pick<Unit, 'territory'>): string => u.territory
