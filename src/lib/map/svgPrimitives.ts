// Ported from diplicity-react — SVG-string primitives for orders/markers.
import type { Point } from './dsvgParser'
import { closestPointOnLine, splineControl } from './orderGeometry'
import { add, len, lerp, midpoint, perp, scale, sub, unit } from './vec'

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

const offsetPoint = (from: Point, toward: Point, offset: number): Point =>
  add(from, scale(unit(sub(toward, from)), offset))

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
  gap?: number
  renderCenter?: (x: number, y: number, angle: number) => string
}

/** A support for a move: a curve that leaves toward the supported unit and ends at the target. */
export const curvedArrow = (o: CurvedArrowOptions): string => {
  const source = { x: o.x1, y: o.y1 }
  const ecp = o.endControlPoint ?? { x: o.x3, y: o.y3 }
  const tip = offsetPoint({ x: o.x2, y: o.y2 }, ecp, o.offset)
  const cp1 = lerp(source, { x: o.x3, y: o.y3 }, 0.5)
  const cp2 = lerp(tip, ecp, 0.5)
  const points = Array.from({ length: 33 }, (_, i) => cubicBezierPoint(i / 32, source, cp1, cp2, tip))
  return ribbonArrow({
    points,
    shaftWidth: o.lineWidth,
    headWidth: o.arrowWidth,
    headLength: o.arrowLength,
    offset: 0,
    startOffset: 0, // from the unit's centre; drawn beneath the unit
    fill: o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
    dash: o.dash,
    centerAt: 0.3,
    gap: o.gap,
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
  gap?: number
  renderCenter?: (x: number, y: number, angle: number) => string
}

export const supportHoldArrow = (o: SupportHoldArrowOptions): string => {
  const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1)
  const endOffset = (o.endOffset ?? o.offset) + 1
  const endX = o.x2 - endOffset * Math.cos(angle)
  const endY = o.y2 - endOffset * Math.sin(angle)
  return (
    `<g>` +
    ribbonArrow({
      points: [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }],
      shaftWidth: o.lineWidth,
      headWidth: 0,
      headLength: 0,
      offset: endOffset,
      startOffset: 0, // from the unit's centre; drawn beneath the unit
      fill: o.fill,
      stroke: o.stroke,
      strokeWidth: o.strokeWidth,
      dash: o.dash,
      gap: o.gap,
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
  const d = sub(end, start)
  const length = len(d)
  if (length === 0) {
    return [start]
  }
  const u = unit(d)
  const p = perp(u)
  const rawHalfWaves = Math.round(length / (WAVE_LENGTH / 2))
  const halfWaves = Math.max(2, rawHalfWaves % 2 === 0 ? rawHalfWaves : rawHalfWaves + 1)
  const halfWaveLength = length / halfWaves
  const points: Point[] = [start]
  for (let i = 0; i < halfWaves; i++) {
    const sign = i % 2 === 0 ? 1 : -1
    const s0 = add(start, scale(u, i * halfWaveLength))
    const e0 = add(start, scale(u, (i + 1) * halfWaveLength))
    const bulge = scale(p, sign * WAVE_AMPLITUDE * BEZIER_K)
    const cp1 = add(add(s0, scale(u, halfWaveLength * 0.25)), bulge)
    const cp2 = add(sub(e0, scale(u, halfWaveLength * 0.25)), bulge)
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
  const fleet = { x: o.x1, y: o.y1 }
  const d = sub(closest, fleet)
  const magnitude = len(d)
  if (magnitude < 1) {
    return o.renderCenter ? `<g>${o.renderCenter(o.x1, o.y1, 0)}</g>` : ''
  }
  const u = unit(d)
  const start = add(fleet, scale(u, o.offset))
  const reach = Math.min(magnitude, o.maxLength ?? magnitude)
  const end = add(fleet, scale(u, reach))
  return (
    `<g>` +
    ribbonArrow({
      points: wavyPoints(start, end),
      shaftWidth: o.lineWidth,
      headWidth: 0,
      headLength: 0,
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

const bSplinePath = (points: Point[]): string => {
  if (points.length < 2) {
    return ''
  }
  if (points.length === 2) {
    return `M ${n(points[0].x)} ${n(points[0].y)} L ${n(points[1].x)} ${n(points[1].y)}`
  }
  const mid = (i: number): Point => midpoint(points[i], points[i + 1])
  const control = (i: number): Point => splineControl(mid(i - 1), points[i], mid(i))
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
  const mid = (i: number): Point => midpoint(points[i], points[i + 1])
  const out: Point[] = [points[0], mid(0)]
  for (let i = 1; i < points.length - 1; i++) {
    const a = mid(i - 1)
    const b = mid(i)
    const c = splineControl(a, points[i], b)
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
      return [...points.slice(0, i), lerp(b, a, k)]
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
      return { point: lerp(a, b, k), angle: Math.atan2(b.y - a.y, b.x - a.x) }
    }
    need -= segment
  }
  const a = points[points.length - 2]
  const b = points[points.length - 1]
  return { point: b, angle: Math.atan2(b.y - a.y, b.x - a.x) }
}

export type RibbonArrowOptions = {
  /** The centre line from the unit to the target, straight or sampled from a curve. */
  points: Point[]
  /** Full width of the shaft. */
  shaftWidth: number
  /** Half-width of the head at its base. */
  headWidth: number
  headLength: number
  /** Trim at the head end (the target unit's radius). */
  offset: number
  /** Trim at the tail end. */
  startOffset: number
  /** Dash the outline (supports and convoys, which do not move a unit). */
  dash?: Dash
  /** Where along the arrow `renderCenter` is placed (0–1, default the middle). */
  centerAt?: number
  /** Break the shaft with a gap this long at the centre (a cut support). */
  gap?: number
  fill: string
  stroke: string
  strokeWidth: number
  renderCenter?: (x: number, y: number, angle: number) => string
}

/** The polyline cut at `fraction` of its length into the part before and the part after. */
const splitPolyline = (points: Point[], fraction: number): [Point[], Point[]] => {
  let need = polylineLength(points) * fraction
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (segment >= need) {
      const at = lerp(a, b, segment ? need / segment : 0)
      return [[...points.slice(0, i), at], [at, ...points.slice(i)]]
    }
    need -= segment
  }
  return [points.slice(), [points[points.length - 1], points[points.length - 1]]]
}

/** The outlined ribbon along an already-trimmed centre line, with a head when `headLength` is set. */
const ribbonPath = (line: Point[], o: RibbonArrowOptions, headLength: number): string => {
  const tip = line[line.length - 1]
  // Without a head (headLength 0) the shaft simply ends square.
  const shaft = headLength ? trimPolylineEnd(line, headLength) : line
  const half = o.shaftWidth / 2
  // Each centre-line point offset sideways along the local direction.
  const side = (i: number, sign: number): Point => {
    const a = shaft[Math.max(i - 1, 0)]
    const b = shaft[Math.min(i + 1, shaft.length - 1)]
    return add(shaft[i], scale(perp(unit(sub(b, a))), half * sign))
  }
  const left = shaft.map((_, i) => side(i, 1))
  const right = shaft.map((_, i) => side(i, -1))
  const base = shaft[shaft.length - 1]
  const headNormal = perp(unit(sub(tip, base)))
  const wing = (sign: number): Point => add(base, scale(headNormal, o.headWidth * sign))
  const head = headLength ? [wing(1), tip, wing(-1)] : []
  const outline = [...left, ...head, ...right.reverse()]
  return `<path d="${outline.map((p, i) => `${i === 0 ? 'M' : 'L'} ${n(p.x)} ${n(p.y)}`).join(' ')} Z" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${n(o.strokeWidth)}"${o.dash ? dashAttr(o.dash) : ''} stroke-linejoin="round"/>`
}

/** An order drawn as one solid outlined shape: a shaft along the points and, optionally, a broad head. */
export const ribbonArrow = (o: RibbonArrowOptions): string => {
  if (o.points.length < 2) {
    return ''
  }
  const line = trimPolylineStart(trimPolylineEnd(o.points, o.offset), o.startOffset)
  if (polylineLength(line) <= o.headLength) {
    return ''
  }
  const centerAt = o.centerAt ?? 0.5
  const center = pointAlong(line, centerAt)
  // A broken shaft: two pieces either side of the centre, the head on the second.
  const pieces = o.gap
    ? (() => {
        const [before, after] = splitPolyline(line, centerAt)
        return ribbonPath(trimPolylineEnd(before, o.gap / 2), o, 0) + ribbonPath(trimPolylineStart(after, o.gap / 2), o, o.headLength)
      })()
    : ribbonPath(line, o, o.headLength)
  return (
    `<g>` +
    pieces +
    (o.renderCenter ? o.renderCenter(center.point.x, center.point.y, center.angle) : '') +
    `</g>`
  )
}

/** A headless order line through waypoints: the leg of a route that runs off the board. */
export const routeLeg = (o: RouteLegOptions): string => {
  if (o.waypoints.length < 2) {
    return ''
  }
  const d = bSplinePath(o.waypoints)
  return `<g>${strokeLine(d, o.stroke, o.lineWidth + o.strokeWidth * 2)}${strokeLine(d, o.fill, o.lineWidth)}</g>`
}
