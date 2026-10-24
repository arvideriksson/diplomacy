// Minimal 2D vector helpers for order geometry. Every helper returns a fresh point.
import type { Point } from './dsvgParser'

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })

export const scale = (v: Point, k: number): Point => ({ x: v.x * k, y: v.y * k })

export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y

export const len = (v: Point): number => Math.sqrt(v.x * v.x + v.y * v.y)

export const dist = (a: Point, b: Point): number => len(sub(a, b))

/** `v` scaled to length 1; the zero vector for a zero-length `v` (never NaN). */
export const unit = (v: Point): Point => {
  const l = len(v)
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }
}

/** `v` rotated a quarter turn (clockwise on screen, where y points down). */
export const perp = (v: Point): Point => ({ x: -v.y, y: v.x })

export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** The point a fraction `t` of the way from `a` to `b`. */
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
