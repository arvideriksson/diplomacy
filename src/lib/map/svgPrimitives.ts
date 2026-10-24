// Ported from diplicity-react — SVG-string primitives for orders/markers.
import type { Point } from './dsvgParser'
import { closestPointOnLine, ROUTE_TENSION } from './orderGeometry'

export type Dash = { length: number; spacing: number }

export const formatCoord = (n: number): string => String(Math.round(n * 100) / 100)

const n = formatCoord

const dashAttr = (dash?: Dash): string =>
  ` stroke-dasharray="${dash ? `${dash.length} ${dash.spacing}` : 'none'}"`

const lineEl = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  strokeWidth: number
): string =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${n(strokeWidth)}"/>`

const strokeLine = (d: string, stroke: string, strokeWidth: number, dash?: Dash): string =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${n(strokeWidth)}"${dashAttr(dash)}/>`

export type CrossOptions = {
  x: number
  y: number
  width: number
  length: number
  angle: number
  fill: string
  stroke: string
  strokeWidth: number
}

export const cross = (o: CrossOptions): string => {
  const half = o.length / 2
  const x1 = o.x - half
  const x2 = o.x + half
  const y3 = o.y - half
  const y4 = o.y + half
  const fillX1 = x1 + o.strokeWidth
  const fillX2 = x2 - o.strokeWidth
  const fillY3 = y3 + o.strokeWidth
  const fillY4 = y4 - o.strokeWidth
  const outer = o.width + o.strokeWidth * 2
  return (
    `<g transform="rotate(${n(o.angle)}, ${n(o.x)}, ${n(o.y)})">` +
    `<g>${lineEl(x1, o.y, x2, o.y, o.stroke, outer)}${lineEl(o.x, y3, o.x, y4, o.stroke, outer)}</g>` +
    `<g>${lineEl(fillX1, o.y, fillX2, o.y, o.fill, o.width)}${lineEl(o.x, fillY3, o.x, fillY4, o.fill, o.width)}</g>` +
    `</g>`
  )
}

export type MinusOptions = CrossOptions

export const minus = (o: MinusOptions): string => {
  const half = o.length / 2
  const y3 = o.y - half
  const y4 = o.y + half
  const fillY3 = y3 + o.strokeWidth
  const fillY4 = y4 - o.strokeWidth
  const outer = o.width + o.strokeWidth * 2
  return (
    `<g transform="rotate(${n(o.angle)}, ${n(o.x)}, ${n(o.y)})">` +
    `<g>${lineEl(o.x, y3, o.x, y4, o.stroke, outer)}</g>` +
    `<g>${lineEl(o.x, fillY3, o.x, fillY4, o.fill, o.width)}</g>` +
    `</g>`
  )
}

export type OctagonOptions = {
  x: number
  y: number
  size: number
  fill: string
  stroke: string
  strokeWidth: number
  renderBottomCenter?: (x: number, y: number) => string
}

export const octagon = (o: OctagonOptions): string => {
  const step = Math.PI / 4
  const radius = o.size / (2 * Math.sin(step))
  const points = Array.from({ length: 8 }, (_, i) => {
    const theta = step * i + Math.PI / 8
    return { x: o.x + radius * Math.cos(theta), y: o.y + radius * Math.sin(theta) }
  })
  const pointsAttr = points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')
  const bottomCenterX = (points[1].x + points[2].x) / 2
  const bottomCenterY = (points[1].y + points[2].y) / 2
  const extra = o.renderBottomCenter ? o.renderBottomCenter(bottomCenterX, bottomCenterY) : ''
  return (
    `<g><polygon points="${pointsAttr}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${n(o.strokeWidth)}"/>` +
    `${extra}</g>`
  )
}

const offsetPoint = (from: Point, toward: Point, offset: number): Point => {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  return { x: from.x + (dx / len) * offset, y: from.y + (dy / len) * offset }
}

const cubicBezierPoint = (t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point => {
  const mt = 1 - t
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  }
}

export type CurvedArrowOptions = {
  x1: number
  y1: number
  x2: number
  y2: number
  x3: number
  y3: number
  offset: number
  fill: string
  lineWidth: number
  stroke: string
  strokeWidth: number
  arrowWidth: number
  arrowLength: number
  dash?: Dash
  endControlPoint?: Point
  renderCenter?: (x: number, y: number, angle: number) => string
}

/** A support for a move: a curve that leaves toward the supported unit and ends at the target. */
export const curvedArrow = (o: CurvedArrowOptions): string => {
  const source = { x: o.x1, y: o.y1 }
  const ecp = o.endControlPoint ?? { x: o.x3, y: o.y3 }
  const tip = offsetPoint({ x: o.x2, y: o.y2 }, ecp, o.offset)
  const cp1 = { x: source.x + (o.x3 - source.x) * 0.5, y: source.y + (o.y3 - source.y) * 0.5 }
  const cp2 = { x: tip.x + (ecp.x - tip.x) * 0.5, y: tip.y + (ecp.y - tip.y) * 0.5 }
  const points = Array.from({ length: 33 }, (_, i) => cubicBezierPoint(i / 32, source, cp1, cp2, tip))
  return swallowtailArrow({
    points,
    shaftWidth: o.lineWidth,
    headWidth: o.arrowWidth,
    headLength: o.arrowLength,
    notch: o.lineWidth / 2,
    offset: 0,
    startOffset: o.offset,
    fill: o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
    dash: o.dash,
    centerAt: 0.3,
    renderCenter: o.renderCenter,
  })
}

export type SupportHoldArrowOptions = {
  x1: number
  y1: number
  x2: number
  y2: number
  offset: number
  endOffset?: number
  lineWidth: number
  fill: string
  stroke: string
  strokeWidth: number
  dash?: Dash
  renderCenter?: (x: number, y: number, angle: number) => string
}

export const supportHoldArrow = (o: SupportHoldArrowOptions): string => {
  const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1)
  const endOffset = (o.endOffset ?? o.offset) + 1
  const endX = o.x2 - endOffset * Math.cos(angle)
  const endY = o.y2 - endOffset * Math.sin(angle)
  return (
    `<g>` +
    swallowtailArrow({
      points: [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }],
      shaftWidth: o.lineWidth,
      headWidth: 0,
      headLength: 0,
      notch: o.lineWidth / 2,
      offset: endOffset,
      startOffset: o.offset,
      fill: o.fill,
      stroke: o.stroke,
      strokeWidth: o.strokeWidth,
      dash: o.dash,
      renderCenter: o.renderCenter,
    }) +
    octagon({ x: endX, y: endY, size: 8, stroke: o.stroke, fill: o.fill, strokeWidth: 3 }) +
    `</g>`
  )
}

const WAVE_AMPLITUDE = 5
const WAVE_LENGTH = 30
const BEZIER_K = 4 / 3

/** Points along a gentle wave from `start` to `end`. */
const wavyPoints = (start: Point, end: Point): Point[] => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.sqrt(dx * dx + dy * dy)
  if (length === 0) {
    return [start]
  }
  const ux = dx / length
  const uy = dy / length
  const px = -uy
  const py = ux
  const rawHalfWaves = Math.round(length / (WAVE_LENGTH / 2))
  const halfWaves = Math.max(2, rawHalfWaves % 2 === 0 ? rawHalfWaves : rawHalfWaves + 1)
  const halfWaveLength = length / halfWaves
  const points: Point[] = [start]
  for (let i = 0; i < halfWaves; i++) {
    const sign = i % 2 === 0 ? 1 : -1
    const s0 = { x: start.x + i * halfWaveLength * ux, y: start.y + i * halfWaveLength * uy }
    const e0 = { x: start.x + (i + 1) * halfWaveLength * ux, y: start.y + (i + 1) * halfWaveLength * uy }
    const cp1 = { x: s0.x + halfWaveLength * 0.25 * ux + sign * WAVE_AMPLITUDE * BEZIER_K * px, y: s0.y + halfWaveLength * 0.25 * uy + sign * WAVE_AMPLITUDE * BEZIER_K * py }
    const cp2 = { x: e0.x - halfWaveLength * 0.25 * ux + sign * WAVE_AMPLITUDE * BEZIER_K * px, y: e0.y - halfWaveLength * 0.25 * uy + sign * WAVE_AMPLITUDE * BEZIER_K * py }
    for (let k = 1; k <= 10; k++) points.push(cubicBezierPoint(k / 10, s0, cp1, cp2, e0))
  }
  return points
}

export type ConvoyArrowOptions = {
  x1: number
  y1: number
  x2: number
  y2: number
  x3: number
  y3: number
  lineWidth: number
  offset: number
  fill: string
  stroke: string
  strokeWidth: number
  attachmentPoint?: Point
  /** Cap on the wave's length from the fleet (a convoy with no matching move stays short). */
  maxLength?: number
  dash?: Dash
  renderCenter?: (x: number, y: number, angle: number) => string
}

export const convoyArrow = (o: ConvoyArrowOptions): string => {
  const closest =
    o.attachmentPoint ??
    closestPointOnLine({ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }, { x: o.x3, y: o.y3 })
  const dx = closest.x - o.x1
  const dy = closest.y - o.y1
  const magnitude = Math.sqrt(dx * dx + dy * dy)
  if (magnitude < 1) {
    return o.renderCenter ? `<g>${o.renderCenter(o.x1, o.y1, 0)}</g>` : ''
  }
  const ux = dx / magnitude
  const uy = dy / magnitude
  const start = { x: o.x1 + o.offset * ux, y: o.y1 + o.offset * uy }
  const reach = Math.min(magnitude, o.maxLength ?? magnitude)
  const end = { x: o.x1 + reach * ux, y: o.y1 + reach * uy }
  return (
    `<g>` +
    swallowtailArrow({
      points: wavyPoints(start, end),
      shaftWidth: o.lineWidth,
      headWidth: 0,
      headLength: 0,
      notch: 0, // starts under the fleet, so it stays filled to the token's edge
      offset: 0,
      startOffset: 0,
      fill: o.fill,
      stroke: o.stroke,
      strokeWidth: o.strokeWidth,
      dash: o.dash,
      renderCenter: o.renderCenter,
    }) +
    `<circle cx="${n(end.x)}" cy="${n(end.y)}" r="5" fill="white" stroke="black" stroke-width="${n(o.strokeWidth)}"/>` +
    `</g>`
  )
}

const unitVector = (dx: number, dy: number): Point => {
  const length = Math.sqrt(dx * dx + dy * dy)
  return length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length }
}

const bSplinePath = (points: Point[]): string => {
  if (points.length < 2) {
    return ''
  }
  if (points.length === 2) {
    return `M ${n(points[0].x)} ${n(points[0].y)} L ${n(points[1].x)} ${n(points[1].y)}`
  }
  const mid = (i: number): Point => ({
    x: (points[i].x + points[i + 1].x) / 2,
    y: (points[i].y + points[i + 1].y) / 2,
  })
  const control = (i: number): Point => {
    const previous = mid(i - 1)
    const next = mid(i)
    const midOfMids = { x: (previous.x + next.x) / 2, y: (previous.y + next.y) / 2 }
    return {
      x: midOfMids.x + ROUTE_TENSION * (points[i].x - midOfMids.x),
      y: midOfMids.y + ROUTE_TENSION * (points[i].y - midOfMids.y),
    }
  }
  const last = points.length - 1
  let d = `M ${n(points[0].x)} ${n(points[0].y)} L ${n(mid(0).x)} ${n(mid(0).y)}`
  for (let i = 1; i < last; i++) {
    const c = control(i)
    const m = mid(i)
    d += ` Q ${n(c.x)} ${n(c.y)} ${n(m.x)} ${n(m.y)}`
  }
  d += ` L ${n(points[last].x)} ${n(points[last].y)}`
  return d
}

export type RouteLegOptions = {
  waypoints: Point[]
  lineWidth: number
  fill: string
  stroke: string
  strokeWidth: number
}

/** Points along the same curve `bSplinePath` draws, for shapes that follow it. */
export const bSplinePoints = (points: Point[], perSegment = 12): Point[] => {
  if (points.length < 3) {
    return points.slice()
  }
  const mid = (i: number): Point => ({
    x: (points[i].x + points[i + 1].x) / 2,
    y: (points[i].y + points[i + 1].y) / 2,
  })
  const out: Point[] = [points[0], mid(0)]
  for (let i = 1; i < points.length - 1; i++) {
    const a = mid(i - 1)
    const b = mid(i)
    const midOfMids = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const c = {
      x: midOfMids.x + ROUTE_TENSION * (points[i].x - midOfMids.x),
      y: midOfMids.y + ROUTE_TENSION * (points[i].y - midOfMids.y),
    }
    out.push(...quadraticPoints(a, c, b, perSegment).slice(1))
  }
  out.push(points[points.length - 1])
  return out
}

/** Points along a quadratic Bézier from `a` to `b` with control point `c`. */
export const quadraticPoints = (a: Point, c: Point, b: Point, steps = 24): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const u = 1 - t
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }
  })

const polylineLength = (points: Point[]): number =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)

/** Cut `by` units of length off the end of a polyline. */
const trimPolylineEnd = (points: Point[], by: number): Point[] => {
  let left = by
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i - 1]
    const b = points[i]
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (segment > left) {
      const k = left / segment
      return [...points.slice(0, i), { x: b.x + (a.x - b.x) * k, y: b.y + (a.y - b.y) * k }]
    }
    left -= segment
  }
  return [points[0], points[0]]
}

const trimPolylineStart = (points: Point[], by: number): Point[] =>
  trimPolylineEnd(points.slice().reverse(), by).reverse()

/** The point at `fraction` of a polyline's length, with the direction there (radians). */
const pointAlong = (points: Point[], fraction: number): { point: Point; angle: number } => {
  let need = polylineLength(points) * fraction
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (segment >= need) {
      const k = segment ? need / segment : 0
      return { point: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, angle: Math.atan2(b.y - a.y, b.x - a.x) }
    }
    need -= segment
  }
  const a = points[points.length - 2]
  const b = points[points.length - 1]
  return { point: b, angle: Math.atan2(b.y - a.y, b.x - a.x) }
}

export type SwallowtailArrowOptions = {
  /** The centre line from the unit to the target, straight or sampled from a curve. */
  points: Point[]
  /** Full width of the shaft. */
  shaftWidth: number
  /** Half-width of the head at its base. */
  headWidth: number
  headLength: number
  /** How far the tail's notch cuts back into the shaft (0 for a square tail). */
  notch: number
  /** Trim at the head end (the target unit's radius). */
  offset: number
  /** Trim at the tail end. */
  startOffset: number
  /** Dash the outline (supports and convoys, which do not move a unit). */
  dash?: Dash
  /** Where along the arrow `renderCenter` is placed (0–1, default the middle). */
  centerAt?: number
  fill: string
  stroke: string
  strokeWidth: number
  renderCenter?: (x: number, y: number, angle: number) => string
}

/** A move order drawn as one solid shape: a shaft with a notched tail and a broad head. */
export const swallowtailArrow = (o: SwallowtailArrowOptions): string => {
  if (o.points.length < 2) {
    return ''
  }
  const line = trimPolylineStart(trimPolylineEnd(o.points, o.offset), o.startOffset)
  if (polylineLength(line) <= o.headLength + o.notch) {
    return ''
  }
  const tip = line[line.length - 1]
  // Without a head (headLength 0) the shaft simply ends square.
  const shaft = o.headLength ? trimPolylineEnd(line, o.headLength) : line
  const half = o.shaftWidth / 2
  // Each centre-line point offset sideways along the local direction.
  const side = (i: number, sign: number): Point => {
    const a = shaft[Math.max(i - 1, 0)]
    const b = shaft[Math.min(i + 1, shaft.length - 1)]
    const dir = unitVector(b.x - a.x, b.y - a.y)
    return { x: shaft[i].x - dir.y * half * sign, y: shaft[i].y + dir.x * half * sign }
  }
  const left = shaft.map((_, i) => side(i, 1))
  const right = shaft.map((_, i) => side(i, -1))
  const base = shaft[shaft.length - 1]
  const headDir = unitVector(tip.x - base.x, tip.y - base.y)
  const wing = (sign: number): Point => ({ x: base.x - headDir.y * o.headWidth * sign, y: base.y + headDir.x * o.headWidth * sign })
  const tailDir = unitVector(shaft[1].x - shaft[0].x, shaft[1].y - shaft[0].y)
  const notch = !o.notch ? [] : [{ x: shaft[0].x + tailDir.x * o.notch, y: shaft[0].y + tailDir.y * o.notch }]
  const head = o.headLength ? [wing(1), tip, wing(-1)] : []
  const outline = [...notch, ...left, ...head, ...right.reverse()]
  const center = pointAlong(line, o.centerAt ?? 0.5)
  return (
    `<g>` +
    `<path d="${outline.map((p, i) => `${i === 0 ? 'M' : 'L'} ${n(p.x)} ${n(p.y)}`).join(' ')} Z" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${n(o.strokeWidth)}"${o.dash ? dashAttr(o.dash) : ''} stroke-linejoin="round"/>` +
    (o.renderCenter ? o.renderCenter(center.point.x, center.point.y, center.angle) : '') +
    `</g>`
  )
}

export type TributaryArrowOptions = {
  /** The supporting unit. */
  source: Point
  /** Centre line of the supported move, from the moving unit to its target. */
  move: Point[]
  /** Where along the move the support joins it (0–1). */
  joinAt: number
  shaftWidth: number
  fill: string
  stroke: string
  strokeWidth: number
  dash?: Dash
  renderCenter?: (x: number, y: number, angle: number) => string
}

/** A support that curves in and merges into the move it supports, like a stream joining a
 *  river. It ends on the move's centre line, so drawn beneath the move arrow the join is hidden. */
export const tributaryArrow = (o: TributaryArrowOptions): string => {
  const join = pointAlong(o.move, o.joinAt)
  const dir = { x: Math.cos(join.angle), y: Math.sin(join.angle) }
  const end = join.point
  const lead = Math.min(22, Math.hypot(end.x - o.source.x, end.y - o.source.y) / 2)
  const cp1 = { x: o.source.x + (end.x - o.source.x) * 0.45, y: o.source.y + (end.y - o.source.y) * 0.45 }
  const cp2 = { x: end.x - dir.x * lead, y: end.y - dir.y * lead }
  return swallowtailArrow({
    points: Array.from({ length: 33 }, (_, i) => cubicBezierPoint(i / 32, o.source, cp1, cp2, end)),
    shaftWidth: o.shaftWidth,
    headWidth: 0,
    headLength: 0,
    notch: 0,
    offset: 0,
    startOffset: 0,
    fill: o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
    dash: o.dash,
    renderCenter: o.renderCenter,
  })
}

/** A headless order line through waypoints: the leg of a route that runs off the board. */
export const routeLeg = (o: RouteLegOptions): string => {
  if (o.waypoints.length < 2) {
    return ''
  }
  const d = bSplinePath(o.waypoints)
  return `<g>${strokeLine(d, o.stroke, o.lineWidth + o.strokeWidth * 2)}${strokeLine(d, o.fill, o.lineWidth)}</g>`
}
