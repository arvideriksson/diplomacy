// 1900 political borders clipped to real coastlines, coloured by empire, small islands
// removed — via the shared projection + base-map modules. Output: preview/1900iterative.svg
import { readFileSync, writeFileSync } from 'node:fs'
import { W, H } from './projection.mjs'
import { BG, EMPIRE_STROKE, buildLandMask, buildPolities, mp2path } from './basemap.mjs'

const here = new URL('.', import.meta.url)
const hist = JSON.parse(readFileSync(new URL('hist1900.geojson', here), 'utf8'))
const land = JSON.parse(readFileSync(new URL('land.geojson', here), 'utf8'))

const mask = buildLandMask(land)
const pols = buildPolities(hist, mask)
const parts = pols.map((p) => `<path d="${mp2path(p.mp)}" fill="${p.fill}" fill-opacity="${p.opacity}" stroke="${EMPIRE_STROKE}" stroke-width="1.1" stroke-linejoin="round"/>`)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/>${parts.join('')}</svg>`
writeFileSync(new URL('../preview/1900iterative.svg', here), svg)
console.log(`wrote tools/geodata/preview/1900iterative.svg (${W}x${H}) — ${pols.length} polities`)
