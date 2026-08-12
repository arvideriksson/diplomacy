// PROTOTYPE: real Natural Earth geometry → SVG for the 1900 region, in our palette.
// Goal: show the coastline/geometry quality vs jDip's autotrace. No provinces yet —
// just land/coast (+ country borders as a preview of how provinces would be carved).
//
//   node tools/geodata/src/prototype.mjs   → writes /tmp/geo-1900.svg
import { readFileSync, writeFileSync } from 'node:fs'
import { geoMercator, geoPath } from 'd3-geo'

const here = new URL('.', import.meta.url)
const load = (f) => JSON.parse(readFileSync(new URL(f, here), 'utf8'))
const land = load('land.geojson')
const countries = load('countries.geojson')

// 1900 covers Europe + North Africa + the Levant.
const REGION = { lonMin: -25, lonMax: 52, latMin: 18, latMax: 71 }
// Fit to the region's CORNER POINTS (a Polygon ring's winding would make d3 treat the
// small rectangle as its whole-world complement). Points have no winding ambiguity.
const corners = {
  type: 'MultiPoint',
  coordinates: [
    [REGION.lonMin, REGION.latMin], [REGION.lonMax, REGION.latMin],
    [REGION.lonMax, REGION.latMax], [REGION.lonMin, REGION.latMax],
  ],
}

const W = 1522
const proj = geoMercator()
proj.fitWidth(W, corners) // region fits width, top-left at 0,0
const fullBounds = geoPath(proj).bounds(corners)
const H = Math.ceil(fullBounds[1][1])
proj.clipExtent([[0, 0], [W, H]]) // crop the rest of the world to the region viewBox
const path = geoPath(proj)
console.log('bbox projected bounds:', JSON.stringify(fullBounds), '→ H', H)

const SEA = '#cbc5a0'
const LAND = '#d4d0ad'
const COAST = 'rgba(0,0,0,0.55)'
const BORDER = '#4a4636'

const landPaths = land.features.map((f) => path(f)).filter(Boolean)
const borderPaths = countries.features.map((f) => path(f)).filter(Boolean)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="${SEA}"/>
  <g id="land" fill="${LAND}" stroke="${COAST}" stroke-width="1" stroke-linejoin="round">
${landPaths.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
  <g id="borders" fill="none" stroke="${BORDER}" stroke-width="0.6" stroke-linejoin="round" opacity="0.55">
${borderPaths.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
</svg>
`
writeFileSync('/tmp/geo-1900.svg', svg)
console.log(`wrote /tmp/geo-1900.svg — ${W}x${H}, ${landPaths.length} land, ${borderPaths.length} country outlines`)
