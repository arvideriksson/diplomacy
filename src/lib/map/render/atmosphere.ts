// Static board art: the procedural atmosphere, label typography and supply-center markers.
import type { Point, ViewBox } from '../dsvgParser'
import type { MapTheme } from '../theme'
import { formatCoord } from '../svgPrimitives'
import {
  SUPPLY_CENTER_OUTER_RADIUS,
  SUPPLY_CENTER_INNER_RADIUS,
} from './constants'

// ── Procedural atmosphere ───────────────────────────────────────────────────────
// A map's look is generated from its geometry + a MapTheme, so any variant is
// presentable from pure data. Used when a dsvg supplies no hand-authored background
// (see render()); an artisanal dsvg with a baked background overrides all of this.

export const proceduralDefs = (theme: MapTheme): string => {
  const defs: string[] = []
  if (theme.coast) {
    const { color, opacity, blur, dx, dy } = theme.coast
    defs.push(
      `<filter id="coastShadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
        `<feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur}" flood-color="${color}" flood-opacity="${opacity}"/>` +
        `</filter>`,
    )
  }
  // Coastline = the OUTLINE of the land silhouette. Dilate the land alpha and subtract
  // the original, so only the rim survives — internal province edges produce no line
  // (the union has no internal alpha gap), giving classical's clean coast over a quiet
  // interior. Applied to a group of all land paths (see proceduralCoastline).
  defs.push(
    `<filter id="coastline" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">` +
      `<feMorphology in="SourceAlpha" operator="dilate" radius="${theme.coastlineWidth}" result="d"/>` +
      `<feComposite in="d" in2="SourceAlpha" operator="out" result="rim"/>` +
      `<feFlood flood-color="${theme.coastline}"/>` +
      `<feComposite in2="rim" operator="in"/>` +
      `</filter>`,
  )
  return defs.join('')
}

/** Sea wash + land base (with a soft coastline shadow) generated from the geometry. */
export const proceduralBackground = (
  provincePaths: Map<string, string>,
  landIds: Set<string>,
  viewBox: ViewBox,
  theme: MapTheme,
): string => {
  // The converter grows each province so neighbours OVERLAP (truly tile — no gaps). Here
  // each province is drawn fill + a thin uniform border stroke, in order. Because the
  // shapes overlap, a later province's fill paints over the earlier neighbour's stroke,
  // so every shared edge shows exactly ONE line of uniform width — independent of how
  // uneven jDip's original gaps were. Seas first, then land (so land covers sea at the
  // coast); within each, draw order just decides which side's stroke wins (visually the
  // same uniform line either way).
  const stroke = `stroke="${theme.border}" stroke-width="${theme.borderWidth}" stroke-linejoin="round"`
  const base = `<rect x="${viewBox.minX}" y="${viewBox.minY}" width="${viewBox.width}" height="${viewBox.height}" fill="${theme.sea}"/>`
  const seaFills: string[] = []
  const land: string[] = []
  for (const [id, d] of provincePaths) {
    if (landIds.has(id)) land.push(`<path d="${d}" fill="${theme.land}" ${stroke}/>`)
    else seaFills.push(`<path d="${d}" fill="${theme.sea}" ${stroke}/>`)
  }
  const filter = theme.coast ? ' filter="url(#coastShadow)"' : ''
  return `${base}${seaFills.join('')}<g${filter}>${land.join('')}</g>`
}

/** Crisp coastline = the outline of the land silhouette, via the #coastline edge filter.
 *  All land paths go in one filtered group, so only the union's rim draws (no internal
 *  province edges). Sits in the foreground, like the classical map's coast strokes. */
export const proceduralCoastline = (
  provincePaths: Map<string, string>,
  landIds: Set<string>,
  theme: MapTheme,
): string => {
  const land: string[] = []
  // Geometry is already grown to tile in the converter, so the land silhouette here
  // matches the land fill; the edge filter traces its outer rim as the coastline.
  for (const [id, d] of provincePaths) {
    if (landIds.has(id)) land.push(`<path d="${d}" fill="#000"/>`)
  }
  if (!land.length) return ''
  return `<g filter="url(#coastline)" pointer-events="none">${land.join('')}</g>`
}

/** Wrap the province-name markup in the theme's typography (with a legibility halo).
 *  Inline styles on individual labels — e.g. an artisanal dsvg's — override these. */
export const themedLabels = (markup: string, theme: MapTheme): string => {
  const { family, size, weight, color, halo, haloWidth } = theme.label
  return (
    `<g font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${color}" ` +
    `paint-order="stroke" stroke="${halo}" stroke-width="${haloWidth}" stroke-linejoin="round">${markup}</g>`
  )
}

export const supplyCenterMarkersLayer = (supplyCenters: Map<string, Point>, radius = SUPPLY_CENTER_OUTER_RADIUS): string => {
  const parts: string[] = []
  for (const [, position] of supplyCenters) {
    const cx = formatCoord(position.x)
    const cy = formatCoord(position.y)
    parts.push(
      `<g><circle cx="${cx}" cy="${cy}" r="${radius}" fill="white" stroke="black" stroke-width="2" opacity="0.8"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${formatCoord(radius * SUPPLY_CENTER_INNER_RADIUS / SUPPLY_CENTER_OUTER_RADIUS)}" fill="white" stroke="black" stroke-width="2" opacity="0.8"/></g>`
    )
  }
  return parts.join('\n')
}
