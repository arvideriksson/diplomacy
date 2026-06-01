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
}

/** A unit identified by where it stands — what the wizard operates on. */
export interface OrderableUnit {
  unit: Unit
  source: string
  sourceCoast?: string
}

export const unitKey = (u: Pick<Unit, 'territory'>): string => u.territory
