// The radial action menu ("bubbles") shown around a unit or supply center on the map:
// order types in movement, retreat/disband in retreats, unit types in builds. Pure data —
// GameBoard decides what to offer, ActionBubbles draws it.
import type { OrderType } from './types'

export interface Bubble {
  /** Returned to the board's pick handler. */
  id: string
  label: string
  /** Inner markup of a 24×24 stroke icon (see BUBBLE_ICONS), or a unit token to draw. */
  icon?: string
  token?: { type: 'Army' | 'Fleet'; color: string }
  /** Desktop keyboard shortcut shown as a hint. */
  key?: string
  /** The unit's current order — drawn filled. */
  active?: boolean
  tone?: 'danger'
  /** Shown for consistency but not available here (e.g. Convoy with no army to carry). */
  disabled?: boolean
}

export interface BubbleMenu {
  /** dSVG id of the unit / province the bubbles circle. */
  anchor: string
  items: Bubble[]
}

export const BUBBLE_ICONS = {
  Move: '<path d="M4 12h14M13 6l6 6-6 6" />',
  Hold: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />',
  Support: '<path d="M12 5v14M5 12h14" />',
  Convoy: '<path d="M3 14h18l-2.5 5h-13z" /><path d="M12 14V4M12 4l5 6h-5" />',
  Retreat: '<path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" />',
  Disband: '<path d="M6 6l12 12M18 6L6 18" />',
  Remove: '<path d="M5 12h14" />',
} as const

/** Order-type bubbles in display order (left → right across the arc). */
export const ORDER_BUBBLES: Array<{ type: OrderType; key: string }> = [
  { type: 'Hold', key: 'H' },
  { type: 'Move', key: 'M' },
  { type: 'Support', key: 'S' },
  { type: 'Convoy', key: 'C' },
]
