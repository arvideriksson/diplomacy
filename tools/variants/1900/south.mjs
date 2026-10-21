// Extend the classical board southward with North Africa, Egypt and the Levant.
// Coastlines come from Natural Earth, projected onto the classical board: a conic
// projection with an affine fit to shared coastal landmarks. Just below the old
// bottom edge the coast is nudged sideways so it meets the classical coast exactly.
import { readFileSync } from 'node:fs'
import { geoConicEquidistant } from 'd3-geo'
import { union, intersect, subtract, poly, area } from './lib/geom.mjs'
import { region, latBand, transform, box } from './lib/natural.mjs'

const SEAM = 1357
// Below this line the Saharan interior is compressed so the southern provinces stay
// compact. The squeeze fades out eastward: Egypt's Red Sea coast, Sinai and Arabia keep
// their true shape.
const SQUEEZE_FROM = 1460, SQUEEZE = 0.45, SQUEEZE_WEST = 1000, SQUEEZE_EAST = 1250
export const squeeze = ([x, y]) => {
  if (y <= SQUEEZE_FROM) return [x, y]
  const t = Math.max(0, Math.min(1, (x - SQUEEZE_WEST) / (SQUEEZE_EAST - SQUEEZE_WEST))), k = SQUEEZE + (1 - SQUEEZE) * t * t * (3 - 2 * t)
  return [x, SQUEEZE_FROM + (y - SQUEEZE_FROM) * k]
}

// Classical province, the extreme taken along `score`, and the real place it depicts.
const LANDMARKS = [
  ['gre', (p) => p[1], [22.48, 36.38]], ['nap', (p) => p[1], [16.06, 37.92]], ['apu', (p) => p[0] + p[1], [18.37, 39.8]],
  ['spa', (p) => p[1], [-5.6, 36.0]], ['por', (p) => p[1] - p[0], [-8.99, 37.02]], ['bre', (p) => -p[0], [-4.79, 48.41]],
  ['den', (p) => -p[1], [10.6, 57.74]], ['nwy', (p) => p[1] - 0.3 * p[0], [7.05, 57.98]], ['tun', (p) => p[0] - p[1], [11.05, 37.08]],
  ['wal', (p) => -p[0], [-5.7, 50.07]], ['edi', (p) => -p[1], [-3.37, 58.67]],
]

export function fitProjection(classical) {
  const conic = geoConicEquidistant().parallels([30, 55]).rotate([-20, 0]).scale(1000).translate([0, 0])
  const squash = 1.05
  const rows = [], bx = [], by = []
  for (const [id, score, lonLat] of LANDMARKS) {
    const pts = classical.provinces[id].flatMap((p) => p[0])
    const target = pts.reduce((a, p) => (score(p) > score(a) ? p : a))
    const q = conic(lonLat); rows.push([q[0], q[1] * squash, 1]); bx.push(target[0]); by.push(target[1])
  }
  const solve = (b) => {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0]
    rows.forEach((r, i) => { for (let a = 0; a < 3; a++) { v[a] += r[a] * b[i]; for (let c = 0; c < 3; c++) M[a][c] += r[a] * r[c] } })
    for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) if (i !== k) { const f = M[i][k] / M[k][k]; for (let c = 0; c < 3; c++) M[i][c] -= f * M[k][c]; v[i] -= f * v[k] }
    return v.map((x, i) => x / M[i][i])
  }
  const cx = solve(bx), cy = solve(by)
  return (lonLat) => { const q = conic(lonLat), r = [q[0], q[1] * squash, 1]; return [cx[0] * r[0] + cx[1] * r[1] + cx[2], cy[0] * r[0] + cy[1] * r[1] + cy[2]] }
}

// Where closed rings cross the horizontal line y, sorted.
const crossings = (rings, y) => {
  const xs = []
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length]
    if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
  }
  return xs.sort((a, b) => a - b)
}

export function southernLand(classical, landIds, { width, height }) {
  const project = fitProjection(classical)
  const geo = JSON.parse(readFileSync(new URL('../../geodata/src/land.geojson', import.meta.url), 'utf8'))
  let rings = []
  for (const f of geo.features) for (const p of f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) {
    if (!p[0].some(([lon, lat]) => lon > -20 && lon < 50 && lat > 15 && lat < 40)) continue
    rings.push(p[0].map(project))
  }
  rings = rings.filter((r) => r.some((p) => p[1] > SEAM - 20 && p[1] < height + 50 && p[0] > -50 && p[0] < width + 50))
  // Align the projected coast with the classical coast along the seam.
  const band = poly([[-40, SEAM - 30], [width + 40, SEAM - 30], [width + 40, SEAM + 30], [-40, SEAM + 30]])
  const classicalLand = union(...landIds.map((id) => intersect(classical.provinces[id], band))).flat()
  // Coast crossings only: drop the frame and pairs from hairline slivers between provinces.
  const want = crossings(classicalLand, SEAM - 0.5).filter((x) => x > 1 && x < width - 1)
    .filter((x, i, xs) => !xs.some((o, j) => j !== i && Math.abs(o - x) < 2))
  let have = crossings(rings, SEAM).filter((x) => x > -40 && x < width + 40)
  // Classical land reaching the left edge at the seam: pin the projected west coast to it.
  if (have.length === want.length + 1 && have[0] < 60) want.unshift(0)
  if (want.length !== have.length) throw new Error(`Seam mismatch: classical ${want.map(Math.round)} vs projected ${have.map(Math.round)}`)
  const shift = (x) => {
    if (x <= have[0]) return want[0] - have[0]
    for (let i = 0; i + 1 < have.length; i++) if (x <= have[i + 1]) { const t = (x - have[i]) / (have[i + 1] - have[i]); return (want[i] - have[i]) * (1 - t) + (want[i + 1] - have[i + 1]) * t }
    return want.at(-1) - have.at(-1)
  }
  const warp = ([x, y]) => [x + shift(x) * Math.max(0, Math.min(1, 1 - (y - SEAM) / 140)), y]
  const toBoard = (lonLat) => squeeze(warp(project(lonLat)))
  const frame = poly([[-60, SEAM - 30], [width + 60, SEAM - 30], [width + 60, height + 60], [-60, height + 60]])
  const land = union(...rings.map((r) => intersect([[r.map((p) => squeeze(warp(p)))]], frame))).filter((p) => area([p]) > 400)
  return { land, toBoard }
}

// The southern 1900 provinces from real borders: colonial North Africa by country,
// Algeria's Saharan provinces as Southern Algeria, Libya's west and east as
// Tripolitania and Cyrenaica, and the Ottoman Levant from the modern states that
// replaced its districts. Aqaba and the Negev's tip (south of 29.9°N) belonged to the Hejaz.
export function southernProvinces(toBoard) {
  const is = (...countries) => (country) => countries.includes(country)
  const hejazSaudi = ['Tabuk', 'Al Madinah', 'Makkah', 'Al Bahah', '`Asir', 'Jizan']
  // In this data Al Jawf reaches the head of the Gulf of Aqaba; that western sliver is Hejaz.
  const jawf = region((c, n) => c === 'Saudi Arabia' && n === 'Al Jawf'), jawfWest = intersect(jawf, box(30, 25, 37, 33))
  // Jordan's eastern panhandle (Mafraq) reaches into the desert; it goes with Arabia.
  const levant = region((c, n) => c === 'Israel' || c === 'Palestine' || (c === 'Jordan' && n !== 'Mafraq'))
  // The board's bottom edge reaches the Sahel; it continues the province above it.
  const sahel = (west, east) => region((c, n, [lon]) => ['Mauritania', 'Western Sahara', 'Mali', 'Niger', 'Chad', 'Sudan'].includes(c) && lon >= west && lon < east)
  const real = {
    mor: region((c, n, [lon, lat]) => c === 'Morocco' || c === 'Western Sahara' || c === 'Mauritania' || (c === 'Algeria' && lat < 33 && lon <= -2)),
    // The Southern Territories began at the Saharan Atlas: wilayas centred south of 33°N.
    alg: region((c, n, [, lat]) => c === 'Algeria' && lat >= 33),
    // Algeria's south-western Saharan provinces (Tindouf, Béchar) go with Morocco so
    // Southern Algeria does not wrap underneath it.
    sou: region((c, n, [lon, lat]) => c === 'Algeria' && lat < 33 && lon > -2),
    tun: region(is('Tunisia')),
    trp: region((c, n, [lon]) => c === 'Libya' && lon < 19),
    cyr: region((c, n, [lon]) => c === 'Libya' && lon >= 19),
    egy: region(is('Egypt')),
    // West of 36.4°E (the Jordan valley and its plateau edge); the desert east of it is Arabia.
    // Palestine includes the Negev and Aqaba down to the Gulf, so Egypt and Hejaz share no
    // land border (their link is the drawn crossing).
    pal: intersect(levant, box(30, 28, 36.4, 34)),
    hej: union(region((c, n) => c === 'Saudi Arabia' && hejazSaudi.includes(n)), jawfWest),
    ara: subtract(region((c, n) => (c === 'Saudi Arabia' && !hejazSaudi.includes(n)) || c === 'Iraq' || (c === 'Jordan' && n === 'Mafraq')), jawfWest),
    araJordan: subtract(levant, box(30, 28, 36.4, 34)),
    dam: region(is('Syria', 'Lebanon')),
  }
  real.sou = union(real.sou, sahel(-6, 11)); real.trp = union(real.trp, sahel(11, 19)); real.cyr = union(real.cyr, sahel(19, 24)); real.egy = union(real.egy, sahel(24, 40))
  real.ara = union(real.ara, real.araJordan); delete real.araJordan
  return Object.fromEntries(Object.entries(real).map(([id, g]) => [id, transform(g, toBoard)]))
}
