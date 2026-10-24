// Ported from diplicity-react — pure geometry helpers for order rendering.
import type { Point } from './dsvgParser'

const ROUTE_TENSION = 0.6
const MOVE_CURVE_OFFSET = 20
const SUPPORT_STAGGER_DISTANCE = 4.375

const euclidean = (a: Point, b: Point): number =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)

/** Unit vector along (dx, dy); zero for a zero-length vector. */
export const unitVector = (dx: number, dy: number): Point => {
  const length = Math.sqrt(dx * dx + dy * dy)
  return length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length }
}

/** The point `distance` from `from` in the direction of `toward`. */
export const offsetToward = (from: Point, toward: Point, distance: number): Point => {
  const u = unitVector(toward.x - from.x, toward.y - from.y)
  return { x: from.x + u.x * distance, y: from.y + u.y * distance }
}

export const closestPointOnLine = (p: Point, a: Point, b: Point): Point => {
  const lineX = b.x - a.x
  const lineY = b.y - a.y
  const pointX = p.x - a.x
  const pointY = p.y - a.y
  const lengthSquared = lineX * lineX + lineY * lineY
  const t = Math.max(0.1, Math.min(0.9, (pointX * lineX + pointY * lineY) / lengthSquared))
  return { x: a.x + t * lineX, y: a.y + t * lineY }
}


export type QuadSegment = { start: Point; control: Point; end: Point }

/**
 * The route curve through `points`: a straight lead-in to the first midpoint, one quadratic
 * segment per inner point (midpoint to midpoint, pulled toward the point by ROUTE_TENSION),
 * and a straight lead-out. Segment i - 1 belongs to inner point i.
 */
export const bSplineSegments = (points: Point[]): QuadSegment[] => {
  const mid = (i: number): Point => ({ x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 })
  const segments: QuadSegment[] = []
  for (let i = 1; i < points.length - 1; i++) {
    const start = mid(i - 1)
    const end = mid(i)
    const midOfMids = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    const control = {
      x: midOfMids.x + ROUTE_TENSION * (points[i].x - midOfMids.x),
      y: midOfMids.y + ROUTE_TENSION * (points[i].y - midOfMids.y),
    }
    segments.push({ start, control, end })
  }
  return segments
}

/** Where the route curve passes inner point `i` (its segment's midpoint). */
const bSplineAttachmentPoint = (points: Point[], i: number): Point => {
  const { start, control, end } = bSplineSegments(points)[i - 1]
  return {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
  }
}

const permutations = <T>(items: T[]): T[][] => {
  if (items.length <= 1) {
    return [items]
  }
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  )
}

const shortestWaypointOrder = <T>(
  items: T[],
  pointOf: (item: T) => Point,
  source: Point,
  destination: Point
): T[] => {
  if (items.length <= 1) {
    return items
  }
  const pathLength = (order: T[]): number => {
    let total = euclidean(source, pointOf(order[0]))
    for (let i = 0; i < order.length - 1; i++) {
      total += euclidean(pointOf(order[i]), pointOf(order[i + 1]))
    }
    return total + euclidean(pointOf(order[order.length - 1]), destination)
  }
  return permutations(items).reduce((best, order) =>
    pathLength(order) < pathLength(best) ? order : best
  )
}

export const headToHeadControlPoint = (p1: Point, p2: Point): Point => {
  const midX = (p1.x + p2.x) / 2
  const midY = (p1.y + p2.y) / 2
  const u = unitVector(p2.x - p1.x, p2.y - p1.y)
  return { x: midX - u.y * MOVE_CURVE_OFFSET, y: midY + u.x * MOVE_CURVE_OFFSET }
}

export const staggeredSupportEnd = (
  aux: Point,
  target: Point,
  staggerIndex: number,
  moveControlPoint?: Point
): Point => {
  // Back from the target along the move's final direction (toward its control point when
  // the move is bowed, else toward the moving unit).
  return offsetToward(target, moveControlPoint ?? aux, (staggerIndex + 1) * SUPPORT_STAGGER_DISTANCE)
}

type ConvoyFleet = { id: string; point: Point }

export type ConvoyRoute = {
  waypoints: Point[]
  attachments: Map<string, Point>
}

export const buildConvoyRoute = (
  source: Point,
  destination: Point,
  fleets: ConvoyFleet[]
): ConvoyRoute => {
  const ordered = shortestWaypointOrder(fleets, (fleet) => fleet.point, source, destination)
  const waypoints = [source, ...ordered.map((fleet) => fleet.point), destination]
  const attachments = new Map<string, Point>()
  ordered.forEach((fleet, index) => {
    attachments.set(fleet.id, bSplineAttachmentPoint(waypoints, index + 1))
  })
  return { waypoints, attachments }
}
