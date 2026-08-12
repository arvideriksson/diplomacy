// Shared projection + cropping for the 1900 geodata maps. Used by 1900iterative (base) and
// the map editor's build-units, so they stay in sync.
//
// PROJECTION and CROP are independent:
//   • Projection = CONIC (geoConicEquidistant) — meridians fan toward the pole, so the map is
//     "wider at the south", the classic Diplomacy look. This only curves the meridians.
//   • Crop = an axis-aligned RECTANGLE in projected pixel space. We project a far WIDER area
//     than is shown so the rectangle is fully covered (no empty corners), then clip to it.
//     The frame edges stay parallel to the x/y axes even though the meridians inside fan.
import { geoConicEquidistant } from 'd3-geo'
import pc from 'polygon-clipping'

export const W = 1522

// Conic with the region's central meridian (~10°E) and two standard parallels → the fan.
export const proj = geoConicEquidistant().parallels([40, 62]).rotate([-10, 0])

// Source extent (lon/lat) that we actually project — deliberately far wider than the crop so
// projected content overflows the rectangle on every side. Clipped here only to keep the conic
// well-behaved (no antipodal points) and to bound the data.
const SRC = { lonMin: -55, lonMax: 70, latMin: 5, latMax: 85 }
const SRC_RECT = [[[SRC.lonMin, SRC.latMin], [SRC.lonMax, SRC.latMin], [SRC.lonMax, SRC.latMax], [SRC.lonMin, SRC.latMax], [SRC.lonMin, SRC.latMin]]]

// Base scale so framing anchors compute at a sane size (rescaled to W below).
proj.fitWidth(1400, { type: 'MultiPoint', coordinates: [[-25, 20], [44, 20], [44, 72], [-25, 72]] })

// The crop rectangle = bounding box of framing anchor points (projected). Each edge is the
// extreme over a few lon/lat anchors so the rectangle frames: Iceland top-left, Portugal near
// the left, sea above the Nordics on top, the N-African fringe on the bottom, the Caspian
// (47°E) cut off on the right.
const P = (lon, lat) => proj([lon, lat])
const xsOf = (pts) => pts.map((p) => P(p[0], p[1])[0])
const ysOf = (pts) => pts.map((p) => P(p[0], p[1])[1])
const ax0 = Math.min(...xsOf([[-19, 41], [-21, 57]]))                          // ~10° Atlantic W of Iberia (as classical)
const ax1 = Math.max(...xsOf([[46, 42], [45, 57]]))                            // Black Sea / Armenia; Caspian (47°E+) cut off
const ay0 = Math.min(...ysOf([[13, 72], [36, 70]]))                            // Barents/Norwegian Sea above the Nordics
const ay1 = Math.max(...ysOf([[13, 27], [36, 28]]))                            // North-African coast (extends classical's south)

// Fine crop tweaks, as fractions of crop width/height: +5% top, −5% bottom, −4% right, −3% left.
const cw = ax1 - ax0, ch = ay1 - ay0
const x0 = ax0 + 0.03 * cw, x1 = ax1 - 0.04 * cw
const y0 = ay0 - 0.05 * ch, y1 = ay1 - 0.05 * ch

// Rescale + translate so the crop rectangle maps exactly to [0,0] … [W,H].
const k = W / (x1 - x0)
const s0 = proj.scale(), [t0, t1] = proj.translate()
proj.scale(s0 * k).translate([k * (t0 - x0), k * (t1 - y0)])
export const H = Math.ceil(k * (y1 - y0))

const RECT_PX = [[[0, 0], [W, 0], [W, H], [0, H], [0, 0]]]

const centroidLL = (g) => { let sx = 0, sy = 0, n = 0; const w = (a) => { if (typeof a[0] === 'number') { sx += a[0]; sy += a[1]; n++ } else a.forEach(w) }; w(g.coordinates); return [sx / n, sy / n] }

// Greenland (+ Svalbard/Jan Mayen) — far-NW landmasses to drop. Tested by CENTROID so it
// never catches Russia (whose polygon reaches the antimeridian) or Britain.
export const isGreenland = (f) => {
  const c = centroidLL(f.geometry)
  return (c[0] < -25 && c[1] > 58) || /greenland/i.test(f.properties.admin || f.properties.NAME || f.properties.name || '')
}

export const inReg = (f) => {
  const t = (c) => c[0] >= SRC.lonMin && c[0] <= SRC.lonMax && c[1] >= SRC.latMin && c[1] <= SRC.latMax
  const w = (a) => (typeof a[0] === 'number') ? t(a) : a.some(w)
  return w(f.geometry.coordinates)
}

// Clip a feature to the source extent (lon/lat) → project (conic) → clip to the axis-aligned
// crop rectangle (px). Returns a px MultiPolygon (Polygon[] of Ring[] of [x,y]).
export const clipProject = (f) => {
  let src; try { src = pc.intersection(f.geometry.coordinates, SRC_RECT) } catch { return [] }
  if (!src.length) return []
  const px = src
    .map((poly) => poly.map((ring) => ring.map((c) => proj(c)).filter((p) => p && isFinite(p[0]))))
    .filter((poly) => poly[0] && poly[0].length > 2)
  if (!px.length) return []
  let clipped; try { clipped = pc.intersection(px, RECT_PX) } catch { return [] }
  return clipped
}
