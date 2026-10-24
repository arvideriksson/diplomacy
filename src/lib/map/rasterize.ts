// Freezes SVG markup into a bitmap. The board's static art (coast shadows, wave strokes,
// blur filters) is far too expensive to re-rasterize on every pan/zoom frame or order
// change, so it is drawn once through an <img> → <canvas> and shown as an <image>.
import type { ViewBox } from './dsvgParser'

export type Raster = {
  /** Object URL of the bitmap (or, if the canvas path fails, of the SVG itself). */
  url: string
  /** The board region the bitmap covers, in viewBox units. */
  region: ViewBox
}

const svgDocument = (inner: string, defs: string, rootFill: string | null, region: ViewBox, px: { w: number; h: number }): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
  `width="${px.w}" height="${px.h}" viewBox="${region.minX} ${region.minY} ${region.width} ${region.height}" ` +
  `preserveAspectRatio="none"${rootFill !== null ? ` fill="${rootFill}"` : ''}>${defs}${inner}</svg>`

/**
 * Rasterize `inner` (with its `defs`) over `region` at `px` pixels. Resolves to an object URL
 * the caller must eventually `URL.revokeObjectURL`. Falls back to the SVG blob itself (still
 * correct, just not pre-rasterized) if the browser refuses the canvas round-trip.
 */
export async function rasterizeSvg(
  inner: string,
  defs: string,
  rootFill: string | null,
  region: ViewBox,
  px: { w: number; h: number },
): Promise<Raster> {
  const w = Math.max(1, Math.round(px.w))
  const h = Math.max(1, Math.round(px.h))
  const svgUrl = URL.createObjectURL(
    new Blob([svgDocument(inner, defs, rootFill, region, { w, h })], { type: 'image/svg+xml' }),
  )
  try {
    const img = new Image()
    img.src = svgUrl
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    // Free the canvas backing store right away rather than waiting for GC.
    canvas.width = canvas.height = 0
    if (!blob) throw new Error('toBlob failed')
    URL.revokeObjectURL(svgUrl)
    const url = URL.createObjectURL(blob)
    // Decode up front so swapping the bitmap in never shows a blank frame.
    const png = new Image()
    png.src = url
    await png.decode().catch(() => {})
    return { url, region }
  } catch {
    return { url: svgUrl, region }
  }
}

// Keep the full-board rasters to ~6 MP each: crisp at 1× on most screens and affordable on
// phones (two layers). Zoomed-in views get a viewport-sized detail raster on top instead.
const BASE_PIXEL_BUDGET = 6_000_000
const BASE_MAX_SCALE = 2

/** Pixels per viewBox unit for the full-board base raster. */
export const baseRasterScale = (viewBox: ViewBox): number =>
  Math.min(BASE_MAX_SCALE, Math.sqrt(BASE_PIXEL_BUDGET / (viewBox.width * viewBox.height)))
