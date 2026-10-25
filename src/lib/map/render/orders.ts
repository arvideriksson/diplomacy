// Order markup: move/support/convoy arrows (drawn beneath the units) and hold/build
// markers (drawn above them).
import type { Point } from '../dsvgParser'
import {
  cross,
  minus,
  octagon,
  curvedArrow,
  supportHoldArrow,
  convoyArrow,
  ribbonArrow,
  bSplinePoints,
  formatCoord,
  quadraticPoints,
  routeLeg,
  tributaryArrow,
} from '../svgPrimitives'
import {
  headToHeadControlPoint,
  staggeredSupportEnd,
  buildConvoyRoute,
  type ConvoyRoute,
} from '../orderGeometry'
import { DEFAULT_UNIT_STYLE, type UnitStyle } from '../unitStyles'
import type { OrderState, RenderOrderType, RenderState } from './types'
import { nationColor } from './color'
import { unitToken } from './units'
import {
  UNIT_RADIUS,
  UNIT_OFFSET_RADIUS,
  DISLODGED_OFFSET,
  GHOST_UNIT_OPACITY,
  ORDER_LINE_WIDTH,
  SUCCESS_COLOR,
  MOVE_SHAFT_WIDTH,
  MOVE_HEAD_WIDTH,
  MOVE_HEAD_LENGTH,
  MOVE_OUTLINE_WIDTH,
  SUPPORT_SHAFT_WIDTH,
  SUPPORT_HEAD_WIDTH,
  SUPPORT_HEAD_LENGTH,
  SUPPORT_DASH,
  CONVOY_STUB_LENGTH,
  HOLD_OCTAGON_SIZE,
  FAILED_SLASH_WIDTH,
  FAILED_SLASH_LENGTH,
  FAILED_SLASH_LEAN,
  FAILED_COLOR,
  CUT_GAP,
  CUT_JAG_HEIGHT,
  ORDER_MARKER_WIDTH,
  ORDER_MARKER_LENGTH,
  ORDER_MARKER_ANGLE,
  BUILD_CROSS_OFFSET_X,
  BUILD_CROSS_OFFSET_Y,
} from './constants'

// A failed order is struck through: one bar across the shaft, leaning off the perpendicular
// so it reads as a slash whichever way the arrow points. `minus` draws a vertical bar, which
// rotated by the arrow's own heading lies square across it.
const failureSlash = (x: number, y: number, angle = 0): string =>
  minus({
    x,
    y,
    width: FAILED_SLASH_WIDTH,
    length: FAILED_SLASH_LENGTH,
    angle: (angle * 180) / Math.PI + FAILED_SLASH_LEAN,
    fill: FAILED_COLOR,
    stroke: 'black',
    strokeWidth: 1.5,
  })

// The jag spanning a cut support's break: a zig-zag across the line, outlined like the slash.
const cutJag = (x: number, y: number, angle = 0): string => {
  const h = CUT_JAG_HEIGHT / 2
  const d = `M -2 ${-h} L 2.5 ${-h / 3} L -2.5 ${h / 3} L 2 ${h}`
  const deg = (angle * 180) / Math.PI
  return (
    `<g transform="translate(${formatCoord(x)}, ${formatCoord(y)}) rotate(${formatCoord(deg)})" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${d}" stroke="black" stroke-width="6.5"/><path d="${d}" stroke="${FAILED_COLOR}" stroke-width="3.5"/></g>`
  )
}

// How a support shows that it failed: a cut one is broken, any other is slashed.
const supportFailure = (order: OrderState) =>
  order.cut ? { gap: CUT_GAP, renderCenter: cutJag } : { renderCenter: order.failed ? failureSlash : undefined }

// A failed hold (the unit was dislodged) is slashed straight through, like a "no" sign.
const holdMarkup = (order: OrderState, position: Point): string =>
  octagon({
    x: position.x,
    y: position.y,
    size: HOLD_OCTAGON_SIZE,
    fill: 'transparent',
    stroke: SUCCESS_COLOR,
    strokeWidth: ORDER_LINE_WIDTH,
    renderBottomCenter: order.failed ? () => failureSlash(position.x, position.y) : undefined,
  })

const buildMarkup = (
  order: OrderState,
  position: Point,
  color: string,
  style: UnitStyle
): string => {
  const token = unitToken(
    position.x,
    position.y,
    order.unitType ?? 'Army',
    color,
    style,
    GHOST_UNIT_OPACITY
  )
  const marker = cross({
    x: position.x + BUILD_CROSS_OFFSET_X,
    y: position.y + BUILD_CROSS_OFFSET_Y,
    width: ORDER_MARKER_WIDTH,
    length: ORDER_MARKER_LENGTH,
    angle: ORDER_MARKER_ANGLE,
    fill: 'green',
    stroke: 'white',
    strokeWidth: 1,
  })
  return `<g>${token}${marker}</g>`
}

/** A drawn route between two provinces (either direction), oriented from `a` to `b`. */
export const lookupFixedRoute = (
  routes: Map<string, Point[][]>,
  a: string,
  b: string,
): Point[][] | undefined =>
  routes.get(`${a}~${b}`) ?? routes.get(`${b}~${a}`)?.slice().reverse().map((leg) => leg.slice().reverse())

/** The waypoints of a fixed route's on-board leg: from `from` (or, for a route that leaves
 *  the board, the re-entry point) through the final leg to `to`. */
const onBoardLeg = (route: Point[][], from: Point, to: Point): Point[] =>
  route.length > 1 ? [...route[route.length - 1], to] : [from, ...route[0], to]

/** Board positions of a support's or convoy's three units, or null when the order is
 *  incomplete or any of them is off the board. */
export const orderPoints = (
  order: OrderState,
  positions: Map<string, Point>,
): { source: Point; target: Point; aux: Point } | null => {
  if (!order.target || !order.aux) return null
  const source = positions.get(order.source)
  const target = positions.get(order.target)
  const aux = positions.get(order.aux)
  return source && target && aux ? { source, target, aux } : null
}

const headToHeadControlPoints = (
  orders: OrderState[],
  unitPositions: Map<string, Point>
): Map<string, Point> => {
  const moves = orders.filter(
    (order) => order.type === 'Move' || order.type === 'MoveViaConvoy'
  )
  const moveKeys = new Set(
    moves.filter((order) => order.target).map((order) => `${order.source}->${order.target}`)
  )
  const controlPoints = new Map<string, Point>()
  for (const order of moves) {
    if (!order.target) {
      continue
    }
    if (!moveKeys.has(`${order.target}->${order.source}`)) {
      continue
    }
    const source = unitPositions.get(order.source)
    const target = unitPositions.get(order.target)
    if (!source || !target) {
      continue
    }
    controlPoints.set(
      `${order.source}->${order.target}`,
      headToHeadControlPoint(source, target)
    )
  }
  return controlPoints
}

const supportMoveGroups = (orders: OrderState[]): Map<string, OrderState[]> => {
  const groups = new Map<string, OrderState[]>()
  for (const order of orders) {
    if (order.type !== 'Support' || !order.aux || !order.target) {
      continue
    }
    if (order.aux === order.target) {
      continue
    }
    const key = `${order.aux}->${order.target}`
    const group = groups.get(key)
    if (group) {
      group.push(order)
    } else {
      groups.set(key, [order])
    }
  }
  return groups
}

const convoyRoutes = (
  orders: OrderState[],
  unitPositions: Map<string, Point>
): Map<string, ConvoyRoute> => {
  const routes = new Map<string, ConvoyRoute>()
  const convoys = orders.filter((order) => order.type === 'Convoy')
  for (const move of orders) {
    if (move.type !== 'MoveViaConvoy' || !move.target) {
      continue
    }
    const source = unitPositions.get(move.source)
    const destination = unitPositions.get(move.target)
    if (!source || !destination) {
      continue
    }
    const fleets = convoys
      .filter((convoy) => convoy.aux === move.source && convoy.target === move.target)
      .map((convoy) => ({ id: convoy.source, point: unitPositions.get(convoy.source) }))
      .filter(
        (fleet): fleet is { id: string; point: Point } => fleet.point !== undefined
      )
    if (fleets.length === 0) {
      continue
    }
    routes.set(`${move.source}->${move.target}`, buildConvoyRoute(source, destination, fleets))
  }
  return routes
}

// A support for a move that is actually ordered (and drawn as a plain move) joins that move's
// arrow as a tributary; any other support for a move points at the target on its own.
const joinsMove = (support: OrderState, orders: OrderState[]): boolean =>
  support.aux !== support.target &&
  orders.some((o) => o.type === 'Move' && o.source === support.aux && o.target === support.target)

// Tributary supports, drawn beneath the move arrows so each join tucks under the shaft.
// Several supports for one move join it at staggered points.
const tributaryParts = (
  orders: OrderState[],
  unitPositions: Map<string, Point>,
  state: RenderState,
  groups: Map<string, OrderState[]>,
  headToHead: Map<string, Point>,
  fixedRoutes: Map<string, Point[][]>
): string[] => {
  const parts: string[] = []
  for (const order of orders) {
    if (order.type !== 'Support' || !order.target || !order.aux || !joinsMove(order, orders)) {
      continue
    }
    const points = orderPoints(order, unitPositions)
    if (!points) {
      continue
    }
    const { source, target, aux } = points
    const fixed = lookupFixedRoute(fixedRoutes, order.aux, order.target)
    const controlPoint = headToHead.get(`${order.aux}->${order.target}`)
    // The move's centre line (an off-board route joins on its final, on-board leg).
    const move = fixed
      ? bSplinePoints(onBoardLeg(fixed, aux, target))
      : controlPoint ? quadraticPoints(aux, controlPoint, target) : [aux, target]
    const group = groups.get(`${order.aux}->${order.target}`) ?? []
    parts.push(
      tributaryArrow({
        source,
        move,
        joinAt: Math.min(0.5 + 0.15 * group.indexOf(order), 0.8),
        shaftWidth: SUPPORT_SHAFT_WIDTH,
        stroke: SUCCESS_COLOR,
        strokeWidth: MOVE_OUTLINE_WIDTH,
        fill: nationColor(state, order.nation),
        dash: SUPPORT_DASH,
        ...supportFailure(order),
      })
    )
  }
  return parts
}

const supportOrderParts = (
  orders: OrderState[],
  unitPositions: Map<string, Point>,
  state: RenderState,
  groups: Map<string, OrderState[]>,
  headToHead: Map<string, Point>
): string[] => {
  const parts: string[] = []
  for (const order of orders) {
    const points = order.type === 'Support' ? orderPoints(order, unitPositions) : null
    if (!points) {
      continue
    }
    const { source, target, aux } = points
    const color = nationColor(state, order.nation)
    const failure = supportFailure(order)

    if (order.aux === order.target) {
      parts.push(
        supportHoldArrow({
          x1: source.x,
          y1: source.y,
          x2: target.x,
          y2: target.y,
          offset: UNIT_RADIUS,
          endOffset: UNIT_RADIUS + UNIT_OFFSET_RADIUS,
          lineWidth: SUPPORT_SHAFT_WIDTH,
          fill: color,
          stroke: SUCCESS_COLOR,
          strokeWidth: MOVE_OUTLINE_WIDTH,
          dash: SUPPORT_DASH,
          ...failure,
        })
      )
      continue
    }

    if (joinsMove(order, orders)) {
      continue
    }
    const moveControlPoint = headToHead.get(`${order.aux}->${order.target}`)
    const group = groups.get(`${order.aux}->${order.target}`) ?? []
    const end = staggeredSupportEnd(aux, target, group.indexOf(order), moveControlPoint)
    parts.push(
      curvedArrow({
        x1: source.x,
        y1: source.y,
        x2: end.x,
        y2: end.y,
        x3: aux.x,
        y3: aux.y,
        offset: UNIT_RADIUS,
        lineWidth: SUPPORT_SHAFT_WIDTH,
        arrowWidth: SUPPORT_HEAD_WIDTH,
        arrowLength: SUPPORT_HEAD_LENGTH,
        strokeWidth: MOVE_OUTLINE_WIDTH,
        stroke: SUCCESS_COLOR,
        fill: color,
        dash: SUPPORT_DASH,
        endControlPoint: moveControlPoint,
        ...failure,
      })
    )
  }
  return parts
}

// The tail starts at the unit's centre, square, so the arrow is filled right up to any token
// shape (a fleet's triangle leaves more of it showing than an army's disc).
const moveArrow = (
  points: Point[],
  color: string,
  renderCenter: ((x: number, y: number, angle: number) => string) | undefined
): string =>
  ribbonArrow({
    points,
    shaftWidth: MOVE_SHAFT_WIDTH,
    headWidth: MOVE_HEAD_WIDTH,
    headLength: MOVE_HEAD_LENGTH,
    offset: UNIT_RADIUS,
    startOffset: 0,
    stroke: SUCCESS_COLOR,
    strokeWidth: MOVE_OUTLINE_WIDTH,
    fill: color,
    renderCenter,
  })

const moveOrderParts = (
  orders: OrderState[],
  unitPositions: Map<string, Point>,
  state: RenderState,
  headToHead: Map<string, Point>,
  routes: Map<string, ConvoyRoute>,
  fixedRoutes: Map<string, Point[][]> = new Map(),
): string[] => {
  const parts: string[] = []
  for (const order of orders) {
    if (order.type !== 'Move' && order.type !== 'MoveViaConvoy') {
      continue
    }
    if (!order.target) {
      continue
    }
    const rawSource = unitPositions.get(order.source)
    const target = unitPositions.get(order.target)
    if (!rawSource || !target) {
      continue
    }
    // A retreat's tail starts at the dislodged token (offset), not the province center
    // where the occupier now sits — otherwise the arrow looks like it leaves the invader.
    const off = order.dislodged ? DISLODGED_OFFSET : 0
    const source = off ? { x: rawSource.x + off, y: rawSource.y + off } : rawSource
    const color = nationColor(state, order.nation)
    const renderCenter = order.failed ? failureSlash : undefined

    // A move along a drawn route (1900: around Africa) follows its waypoints. A route with two
    // legs leaves the board after the first (a headless line) and re-enters for the second.
    const fixed = lookupFixedRoute(fixedRoutes, order.source, order.target)
    if (fixed && order.type === 'Move') {
      if (fixed.length > 1) {
        parts.push(routeLeg({ waypoints: [source, ...fixed[0]], lineWidth: MOVE_SHAFT_WIDTH - MOVE_OUTLINE_WIDTH, strokeWidth: MOVE_OUTLINE_WIDTH, stroke: SUCCESS_COLOR, fill: color }))
      }
      parts.push(moveArrow(bSplinePoints(onBoardLeg(fixed, source, target)), color, renderCenter))
      continue
    }
    if (order.type === 'MoveViaConvoy') {
      const route = routes.get(`${order.source}->${order.target}`)
      if (route) {
        parts.push(moveArrow(bSplinePoints(route.waypoints), color, renderCenter))
        continue
      }
    }
    const controlPoint = headToHead.get(`${order.source}->${order.target}`)
    parts.push(moveArrow(controlPoint ? quadraticPoints(source, controlPoint, target) : [source, target], color, renderCenter))
  }
  return parts
}

const convoyOrderParts = (
  orders: OrderState[],
  unitPositions: Map<string, Point>,
  state: RenderState,
  routes: Map<string, ConvoyRoute>
): string[] => {
  const parts: string[] = []
  for (const order of orders) {
    const points = order.type === 'Convoy' ? orderPoints(order, unitPositions) : null
    if (!points) {
      continue
    }
    const { source, target, aux } = points
    const route = routes.get(`${order.aux}->${order.target}`)
    parts.push(
      convoyArrow({
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y,
        x3: aux.x,
        y3: aux.y,
        lineWidth: SUPPORT_SHAFT_WIDTH,
        offset: 0, // from the fleet's centre; drawn behind the unit like a move
        stroke: SUCCESS_COLOR,
        strokeWidth: MOVE_OUTLINE_WIDTH,
        fill: nationColor(state, order.nation),
        attachmentPoint: route?.attachments.get(order.source),
        // With no convoyed move to join, the wave only hints at the direction and stays
        // within the fleet's own sea.
        maxLength: route ? undefined : CONVOY_STUB_LENGTH,
        renderCenter: order.failed ? failureSlash : undefined,
      })
    )
  }
  return parts
}

// Orders split into two z-layers: `behind` (move, support and convoy arrows, drawn under the units so a
// triangular fleet's token cleanly covers the arrow's center-anchored tail) and
// `front` (everything else, drawn over the units as before).
export const ordersLayer = (
  unitPositions: Map<string, Point>,
  state: RenderState,
  fixedRoutes: Map<string, Point[][]> = new Map(),
): { behind: string; front: string } => {
  const orders = state.orders ?? []
  const ofType = (type: RenderOrderType): OrderState[] => orders.filter((order) => order.type === type)
  const headToHead = headToHeadControlPoints(orders, unitPositions)
  const groups = supportMoveGroups(orders)
  const routes = convoyRoutes(orders, unitPositions)
  const behind: string[] = [
    ...tributaryParts(orders, unitPositions, state, groups, headToHead, fixedRoutes),
    ...supportOrderParts(orders, unitPositions, state, groups, headToHead),
    ...moveOrderParts(orders, unitPositions, state, headToHead, routes, fixedRoutes),
  ]
  const front: string[] = []

  for (const order of ofType('Hold')) {
    const position = unitPositions.get(order.source)
    if (position) {
      front.push(holdMarkup(order, position))
    }
  }
  behind.push(...convoyOrderParts(orders, unitPositions, state, routes))
  for (const order of ofType('Build')) {
    const position = unitPositions.get(order.source)
    if (position) {
      front.push(
        buildMarkup(order, position, nationColor(state, order.nation), state.unitStyle ?? DEFAULT_UNIT_STYLE)
      )
    }
  }
  // Disband is not drawn here: its "−" is a unit addon (see unitAddons), so the marker
  // tracks the exact token — including a dislodged unit offset beside its occupier — and
  // appears wherever the unit is redrawn (e.g. the spotlight overlay).
  return { behind: behind.join('\n'), front: front.join('\n') }
}
