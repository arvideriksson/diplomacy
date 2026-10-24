// Ported from diplicity-react — pure geometry helpers for order rendering.
import type { Point } from './dsvgParser'
import { add, dist, dot, lerp, midpoint, perp, scale, sub, unit } from './vec'

export const ROUTE_TENSION = 0.6
export const MOVE_CURVE_OFFSET = 20
export const SUPPORT_STAGGER_DISTANCE = 4.375

export const euclidean = dist

/** The point on segment a–b nearest p, clamped to the middle 80% of the segment. */
export const closestPointOnLine = (p: Point, a: Point, b: Point): Point => {
  const line = sub(b, a)
  const t = Math.max(0.1, Math.min(0.9, dot(sub(p, a), line) / dot(line, line)))
  return add(a, scale(line, t))
}

/** The control point of a B-spline route's corner at `waypoint`, between the midpoints of
 *  its two legs: their midpoint pulled toward the waypoint by ROUTE_TENSION. */
export const splineControl = (midBefore: Point, waypoint: Point, midAfter: Point): Point =>
  lerp(midpoint(midBefore, midAfter), waypoint, ROUTE_TENSION)

export const bSplineAttachmentPoint = (points: Point[], i: number): Point => {
  const current = points[i]
  const mid0 = midpoint(points[i - 1], current)
  const mid1 = midpoint(current, points[i + 1])
  const control = splineControl(mid0, current, mid1)
  return {
    x: 0.25 * mid0.x + 0.5 * control.x + 0.25 * mid1.x,
    y: 0.25 * mid0.y + 0.5 * control.y + 0.25 * mid1.y,
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

export const shortestWaypointOrder = <T>(
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

export const headToHeadControlPoint = (p1: Point, p2: Point): Point =>
  add(midpoint(p1, p2), scale(perp(unit(sub(p2, p1))), MOVE_CURVE_OFFSET))

export const staggeredSupportEnd = (
  aux: Point,
  target: Point,
  staggerIndex: number,
  moveControlPoint?: Point
): Point => {
  const staggerDistance = (staggerIndex + 1) * SUPPORT_STAGGER_DISTANCE
  // Back off the target along the incoming move: its curve if it has one, else the line from aux.
  const from = moveControlPoint ?? aux
  return add(target, scale(unit(sub(from, target)), staggerDistance))
}

export type ConvoyFleet = { id: string; point: Point }

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
