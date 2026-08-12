// Converter: jDip 1900 variant plugin  ->  our layered .dsvg + MapDefinition (.ts).
//
//   node --experimental-strip-types tools/variants/1900/build.mjs
//
// Reads the three vendored jDip files in ./source and emits:
//   - public/maps/1900.dsvg     (same layered format as classical.dsvg)
//   - src/lib/maps/1900.ts      (MapDefinition: territories graph + startingUnits)
//
// Dependency-free: the jDip files are simple attribute-based XML/SVG, so we parse
// with targeted regexes rather than pulling in a DOM. The only fiddly bit is baking
// jDip's MapLayer transform into the province path geometry (see transformPath).
//
// Source attribution: see ./source/NOTICE.md (jDip / Baron M. Powell, GPL).

import { readFileSync, writeFileSync } from 'node:fs'

const HERE = new URL('.', import.meta.url)
const SRC = (f) => new URL(`source/${f}`, HERE)
const repo = (p) => new URL(`../../../${p}`, HERE)

const svgText = readFileSync(SRC('1900_dipmap.svg'), 'utf8')
const adjText = readFileSync(SRC('1900_adjacency.xml'), 'utf8')
const varText = readFileSync(SRC('variants.xml'), 'utf8')

// ── conventions ──────────────────────────────────────────────────────────────
// Our territory keys are uppercase 3-letter codes; jDip shortnames are lowercase
// 3-letter. The 1900 map is self-contained (we generate both the geometry and the
// definition here), so a straight uppercase is internally consistent — no need to
// reconcile with standard.ts's idiosyncratic codes.
const CODE = (jdip) => jdip.toUpperCase()

// jDip power name -> our power id (reuse standard ids so flag/colour assets resolve).
const POWER = {
  austria: 'austria',
  britain: 'england', // 1900 calls it Britain; we keep the 'england' id for assets
  france: 'france',
  germany: 'germany',
  italy: 'italy',
  russia: 'russia',
  turkey: 'turkey',
}

// The Russian "Steamroller" dummy SC is an off-map bookkeeping center, not a real
// province. Skip it everywhere; the adjudicator handles the +1-unit rule itself.
const DUMMY = 'dum'

// jDip refs may use either a province shortname OR one of its UNIQUENAME aliases
// (e.g. "mao" is an alias for shortname "mid"). Populated during adjacency parse.
const aliasToShort = new Map() // lowercased alias/shortname -> canonical shortname

// Strip a coast suffix, resolve any alias, and uppercase: "mao" -> "MID", "spa-wc" -> "SPA".
const baseRef = (ref) => {
  const base = ref.split('-')[0].toLowerCase()
  return CODE(aliasToShort.get(base) ?? base)
}

// ── 1. adjacency.xml: province graph ───────────────────────────────────────────
/** jdip shortname -> { name, conv, adj: { mv:[], xc:[], nc:[], sc:[], wc:[], ec:[] } } */
const provinces = new Map()
const PROV_RE = /<PROVINCE\s+shortname="([^"]+)"\s+fullname="([^"]+)"([^>]*)>([\s\S]*?)<\/PROVINCE>/g
for (let m; (m = PROV_RE.exec(adjText)); ) {
  const [, short, full, attrs, body] = m
  if (short === DUMMY) continue
  aliasToShort.set(short.toLowerCase(), short)
  for (const u of body.matchAll(/<UNIQUENAME\s+name="([^"]+)"/g)) {
    aliasToShort.set(u[1].toLowerCase(), short)
  }
  const adj = { mv: [], xc: [], nc: [], sc: [], wc: [], ec: [] }
  const ADJ_RE = /<ADJACENCY\s+type="(\w+)"\s+refs="([^"]*)"\s*\/>/g
  for (let a; (a = ADJ_RE.exec(body)); ) {
    const refs = a[2].trim().split(/\s+/).filter(Boolean)
    adj[a[1]] = refs
  }
  provinces.set(short, {
    name: full,
    conv: /isConvoyableCoast="true"/.test(attrs),
    adj,
  })
}

// ── 2. variants.xml: SCs, home powers, starting units ──────────────────────────
const scOwner = new Map() // jdip short -> { home?: ourPowerId }
const SC_RE = /<SUPPLYCENTER\s+province="([^"]+)"([^/]*)\/>/g
for (let m; (m = SC_RE.exec(varText)); ) {
  const [, prov, attrs] = m
  if (prov === DUMMY) continue
  const home = /homepower="([^"]+)"/.exec(attrs)?.[1]
  scOwner.set(prov, { home: home ? POWER[home] : undefined })
}

const starting = [] // { type, power, territory, coast? }
const IS_RE = /<INITIALSTATE\s+province="([^"]+)"\s+power="([^"]+)"\s+unit="([^"]+)"([^/]*)\/>/g
for (let m; (m = IS_RE.exec(varText)); ) {
  const [, prov, power, unit, attrs] = m
  const coast = /unitcoast="([^"]+)"/.exec(attrs)?.[1]
  starting.push({
    type: unit === 'fleet' ? 'fleet' : 'army',
    power: POWER[power],
    territory: CODE(prov),
    coast: coast || undefined,
  })
}

// ── 3. dipmap.svg: geometry + placement ─────────────────────────────────────────
// 3a. jdipNS placement: per-province UNIT (unit dot + render center) and, for SC
//     provinces, SUPPLY_CENTER dot. All already in viewBox space.
const unitPt = new Map() // jdip short -> {x,y}
const scPt = new Map() // jdip short -> {x,y}
const PDATA_RE = /<jdipNS:PROVINCE\s+name="([^"]+)">([\s\S]*?)<\/jdipNS:PROVINCE>/g
for (let m; (m = PDATA_RE.exec(svgText)); ) {
  const [, name, body] = m
  const u = /<jdipNS:UNIT\s+x="([\d.]+)"\s+y="([\d.]+)"/.exec(body)
  if (u) unitPt.set(name, { x: +u[1], y: +u[2] })
  const s = /<jdipNS:SUPPLY_CENTER\s+x="([\d.]+)"\s+y="([\d.]+)"/.exec(body)
  if (s) scPt.set(name, { x: +s[1], y: +s[2] })
}

// 3b. province fill paths: <path id="_xxx" class="water|nopower" d="..."> inside
//     <g id="MapLayer" transform="translate(0,713) scale(0.1,-0.1)">. Bake the
//     transform into the path data so the geometry lands in our 0..761 / 0..713 box.
const viewBox = (() => {
  const v = /viewBox="([^"]+)"/.exec(svgText)[1].trim().split(/[\s,]+/).map(Number)
  return { minX: v[0], minY: v[1], width: v[2], height: v[3] }
})()
const FLIP_H = viewBox.height // 713

// Resolution normalization. jDip's native space (~761 wide) is half the classical
// map's (~1524), so fixed-size units/labels/strokes would render ~2x too big. Scale
// all geometry to the classical resolution so every variant shares one visual scale.
const RES = 2

// Transform one (x,y): absolute affine, or relative linear-only. Bakes jDip's
// translate(0,713) scale(0.1,-0.1), then the RES upscale.
const tx = (x, abs) => round(0.1 * RES * x)
const ty = (y, abs) => round((abs ? FLIP_H - 0.1 * y : -0.1 * y) * RES)
const round = (n) => Math.round(n * 100) / 100
// Placement coords (jdipNS UNIT/SC, in native ~761 space) scaled to match.
const S = (n) => Math.round(n * RES)

const PAIRS = { M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4, H: 1, V: 1, Z: 0 }
function transformPath(d) {
  const toks = d.match(/[MmLlCcHhVvSsQqTtZz]|-?\d*\.?\d+(?:[eE]-?\d+)?/g) || []
  const out = []
  let i = 0
  let cmd = ''
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) {
      cmd = toks[i++]
      const up = cmd.toUpperCase()
      if (up === 'A') throw new Error('arc command not supported by transformPath')
      out.push(cmd)
      if (up === 'Z') continue
    }
    const up = cmd.toUpperCase()
    const abs = cmd === up
    const n = PAIRS[up]
    if (up === 'H') {
      out.push(tx(+toks[i++], abs))
    } else if (up === 'V') {
      out.push(ty(+toks[i++], abs))
    } else {
      // n coordinates = n/2 (x,y) pairs
      for (let p = 0; p < n / 2; p++) {
        out.push(tx(+toks[i++], abs), ty(+toks[i++], abs))
      }
    }
    // After the first M/m, subsequent implicit pairs are L/l (SVG rule).
    if (up === 'M') cmd = abs ? 'L' : 'l'
  }
  // Re-join: letters stand alone, numbers space-separated.
  return out.map((t) => (typeof t === 'string' ? ` ${t} ` : t)).join(' ').replace(/\s+/g, ' ').trim()
}

// ── Geometry cleanup ────────────────────────────────────────────────────────────
// jDip's province shapes are independently traced (potrace): jagged, and inset so
// neighbours don't quite touch — the thin gaps read as "rivers". Clean each fill by
// flattening to points, simplifying away the trace noise, growing slightly so adjacent
// provinces overlap (gaps close — same-colour overlap is invisible, and land is drawn
// over sea), then re-emitting as a smooth closed curve. Distances are in canonical px.
const FLATTEN = 8 // samples per cubic
const SIMPLIFY = 0.8 // RDP tolerance (de-noise the trace)
const GROW = 2.0 // grow past the inter-province gaps so neighbours OVERLAP and truly tile;
//                  the renderer then draws a thin uniform border stroke per province, and
//                  the overlap hides each neighbour's stroke → a single clean border line.

const flattenToPoints = (d) => {
  const toks = d.match(/[MmLlCcHhVvZz]|-?\d*\.?\d+(?:[eE]-?\d+)?/g) || []
  const subs = []
  let cur = null
  let x = 0
  let y = 0
  let cmd = ''
  let i = 0
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let k = 1; k <= FLATTEN; k++) {
      const t = k / FLATTEN
      const u = 1 - t
      cur.push({
        x: u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        y: u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      })
    }
    x = x3
    y = y3
  }
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) {
      cmd = toks[i++]
      const up = cmd.toUpperCase()
      if (up === 'M') {
        if (cur && cur.length) subs.push(cur)
        cur = []
        const abs = cmd === up
        let nx = +toks[i++]
        let ny = +toks[i++]
        if (!abs) {
          nx += x
          ny += y
        }
        x = nx
        y = ny
        cur.push({ x, y })
        cmd = abs ? 'L' : 'l'
      } else if (up === 'Z') {
        if (cur && cur.length) {
          subs.push(cur)
          cur = null
        }
      }
      continue
    }
    const up = cmd.toUpperCase()
    const abs = cmd === up
    if (up === 'L') {
      let nx = +toks[i++]
      let ny = +toks[i++]
      if (!abs) {
        nx += x
        ny += y
      }
      x = nx
      y = ny
      cur.push({ x, y })
    } else if (up === 'H') {
      let nx = +toks[i++]
      if (!abs) nx += x
      x = nx
      cur.push({ x, y })
    } else if (up === 'V') {
      let ny = +toks[i++]
      if (!abs) ny += y
      y = ny
      cur.push({ x, y })
    } else if (up === 'C') {
      const a = +toks[i++]
      const b = +toks[i++]
      const c = +toks[i++]
      const e = +toks[i++]
      const f = +toks[i++]
      const g = +toks[i++]
      cubic(abs ? a : x + a, abs ? b : y + b, abs ? c : x + c, abs ? e : y + e, abs ? f : x + f, abs ? g : y + g)
    } else {
      i++
    }
  }
  if (cur && cur.length) subs.push(cur)
  return subs
}

const polyArea = (p) => {
  let a = 0
  for (let k = 0; k < p.length; k++) {
    const q = p[(k + 1) % p.length]
    a += p[k].x * q.y - q.x * p[k].y
  }
  return a / 2
}

// Ramer–Douglas–Peucker on a ring.
const simplify = (p, eps) => {
  if (p.length < 4) return p
  const keep = new Array(p.length).fill(false)
  keep[0] = keep[p.length - 1] = true
  const seg = (pt, a, b) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy || 1
    const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2
    return (pt.x - (a.x + t * dx)) ** 2 + (pt.y - (a.y + t * dy)) ** 2
  }
  const stack = [[0, p.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let md = 0
    let mi = -1
    for (let k = s + 1; k < e; k++) {
      const d = seg(p[k], p[s], p[e])
      if (d > md) {
        md = d
        mi = k
      }
    }
    if (md > eps * eps) {
      keep[mi] = true
      stack.push([s, mi], [mi, e])
    }
  }
  return p.filter((_, k) => keep[k])
}

// Offset a closed ring outward by d (miter join, clamped against spikes).
const growRing = (p, d) => {
  const n = p.length
  if (n < 3) return p
  const sign = polyArea(p) > 0 ? 1 : -1
  const out = []
  for (let k = 0; k < n; k++) {
    const a = p[(k - 1 + n) % n]
    const c = p[k]
    const b = p[(k + 1) % n]
    let n1x = c.y - a.y
    let n1y = -(c.x - a.x)
    let n2x = b.y - c.y
    let n2y = -(b.x - c.x)
    const l1 = Math.hypot(n1x, n1y) || 1
    const l2 = Math.hypot(n2x, n2y) || 1
    n1x /= l1
    n1y /= l1
    n2x /= l2
    n2y /= l2
    let bx = n1x + n2x
    let by = n1y + n2y
    const bl = Math.hypot(bx, by) || 1
    bx /= bl
    by /= bl
    const cos = Math.max(0.25, n1x * bx + n1y * by)
    const m = d / cos
    out.push({ x: c.x + sign * bx * m, y: c.y + sign * by * m })
  }
  return out
}

// Re-emit a ring as a smooth closed curve (uniform Catmull-Rom → cubic beziers).
const smoothRing = (p) => {
  const n = p.length
  if (n < 2) return ''
  let s = `M ${round(p[0].x)} ${round(p[0].y)}`
  for (let k = 0; k < n; k++) {
    const p0 = p[(k - 1 + n) % n]
    const p1 = p[k]
    const p2 = p[(k + 1) % n]
    const p3 = p[(k + 2) % n]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    s += ` C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2.x)} ${round(p2.y)}`
  }
  return `${s} Z`
}

const cleanFill = (d) =>
  flattenToPoints(d)
    .map((sub) => {
      let p = sub.filter((pt, k) => k === 0 || Math.hypot(pt.x - sub[k - 1].x, pt.y - sub[k - 1].y) > 0.05)
      if (p.length > 1 && Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y) < 0.05) p.pop()
      p = simplify(p, SIMPLIFY)
      if (p.length < 3) return ''
      p = growRing(p, GROW)
      return smoothRing(p)
    })
    .filter(Boolean)
    .join(' ')

const fillPath = new Map() // jdip short -> transformed d
const fillClass = new Map()
const addFill = (short, cls, ds) => {
  if (short === DUMMY || short === 'unplayable_land') return
  fillPath.set(short, ds.map(transformPath).join(' '))
  fillClass.set(short, cls)
}
// Form 1: single-path provinces — <path id="_xxx" class="..." d="...">.
const FILL_RE = /<path\s+id="_([a-z]+)"\s+class="([^"]*)"\s+d="([^"]*)"/g
for (let m; (m = FILL_RE.exec(svgText)); ) addFill(m[1], m[2], [m[3]])
// Form 2: multi-piece provinces (islands/straits) — <g id="_xxx" class="...">
// wrapping several <path d="..."> with no ids. Merge children into one compound path.
const GFILL_RE = /<g\s+id="_([a-z]+)"\s+class="([^"]*)">([\s\S]*?)<\/g>/g
for (let m; (m = GFILL_RE.exec(svgText)); ) {
  const ds = [...m[3].matchAll(/<path\s+d="([^"]*)"/g)].map((p) => p[1])
  if (ds.length) addFill(m[1], m[2], ds)
}

// Light de-noise + smooth of the raw potrace traces (NO grow — the thin inter-province
// gaps are kept on purpose: the renderer fills them with the border colour, so each gap
// becomes a single shared border line, the way jDip's original black background did).
for (const [k, d] of fillPath) fillPath.set(k, cleanFill(d))

// ── 4. derive territory definitions ─────────────────────────────────────────────
const COASTS = ['nc', 'sc', 'wc', 'ec']
const territories = []
const problems = []

// A named coast's marker: the province centre pulled ~45% toward the centroid of the
// seas that coast faces, so e.g. Spain's north/west/east fleets sit on the right side.
const coastCenter = (provU, fleetAdj) => {
  if (!provU) return [0, 0]
  const pts = fleetAdj.map((cid) => unitPt.get(cid.toLowerCase())).filter(Boolean)
  if (!pts.length) return [S(provU.x), S(provU.y)]
  const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length
  const cy = pts.reduce((a, q) => a + q.y, 0) / pts.length
  return [S(provU.x + 0.45 * (cx - provU.x)), S(provU.y + 0.45 * (cy - provU.y))]
}

for (const [short, p] of provinces) {
  const id = CODE(short)
  const hasMv = p.adj.mv.length > 0
  const namedCoasts = COASTS.filter((c) => p.adj[c].length > 0)
  const hasXc = p.adj.xc.length > 0

  // type: sea = fleet-only (no army moves); coast = army + any sea edge; else land.
  let type
  if (!hasMv) type = 'sea'
  else if (hasXc || namedCoasts.length) type = 'coast'
  else type = 'land'

  // adjacent = general graph = army moves UNION every fleet target (coast-stripped).
  const adjacent = new Set()
  for (const r of p.adj.mv) adjacent.add(baseRef(r))
  for (const r of p.adj.xc) adjacent.add(baseRef(r))
  for (const c of namedCoasts) for (const r of p.adj[c]) adjacent.add(baseRef(r))
  // A sea's "adjacent" IS its fleet graph (= xc refs); for seas mv is empty so this holds.

  const unit = unitPt.get(short)
  if (!unit) problems.push(`no UNIT placement for ${short}`)
  if (type !== 'sea' && !fillPath.has(short)) problems.push(`no fill path for ${short}`)

  const sc = scOwner.has(short)
  const def = {
    id,
    name: p.name,
    type,
    supplyCenter: sc,
    homePower: sc ? scOwner.get(short).home : undefined,
    adjacent: [...adjacent].sort(),
    center: unit ? [S(unit.x), S(unit.y)] : [0, 0],
    conv: p.conv,
  }

  if (type === 'coast') {
    if (namedCoasts.length) {
      def.coasts = {}
      for (const c of namedCoasts) {
        const fleetAdj = [...new Set(p.adj[c].map(baseRef))].sort()
        def.coasts[c] = {
          name: { nc: 'North Coast', sc: 'South Coast', wc: 'West Coast', ec: 'East Coast' }[c],
          fleetAdjacency: fleetAdj,
          center: coastCenter(unit, fleetAdj), // pulled toward the seas this coast faces
        }
      }
    } else {
      def.fleetAdjacent = [...new Set(p.adj.xc.map(baseRef))].sort()
    }
  }
  territories.push(def)
}

if (problems.length) {
  console.warn(`⚠ ${problems.length} placement/geometry gaps:\n  ` + problems.join('\n  '))
}

// ── 5. emit src/lib/maps/1900.ts ────────────────────────────────────────────────
const POWERS = [
  { id: 'austria', name: 'Austria-Hungary', color: '#f0574e' },
  { id: 'england', name: 'Britain', color: '#4b85fe' },
  { id: 'france', name: 'France', color: '#00bdd5' },
  { id: 'germany', name: 'Germany', color: '#8c929f' },
  { id: 'italy', name: 'Italy', color: '#4aa961' },
  { id: 'russia', name: 'Russia', color: '#9975fa' },
  { id: 'turkey', name: 'Turkey', color: '#f5af20' },
]

const q = (s) => `'${s}'`
const arr = (xs) => `[${xs.map(q).join(', ')}]`

function emitTerritory(t) {
  const lines = []
  const head = [`type: ${q(t.type)}`, `supplyCenter: ${t.supplyCenter}`]
  if (t.homePower) head.push(`homePower: ${q(t.homePower)}`)
  lines.push(`    ${t.id}: {`)
  lines.push(`      name: ${q(t.name)}, ${head.join(', ')},`)
  lines.push(`      adjacent: ${arr(t.adjacent)},`)
  if (t.coasts) {
    lines.push(`      coasts: {`)
    for (const [k, c] of Object.entries(t.coasts)) {
      lines.push(
        `        ${k}: { name: ${q(c.name)}, fleetAdjacency: ${arr(c.fleetAdjacency)}, render: { center: [${c.center[0]}, ${c.center[1]}] } },`,
      )
    }
    lines.push(`      },`)
  } else if (t.fleetAdjacent) {
    lines.push(`      fleetAdjacent: ${arr(t.fleetAdjacent)},`)
  }
  lines.push(`      render: { center: [${t.center[0]}, ${t.center[1]}] },`)
  lines.push(`    },`)
  return lines.join('\n')
}

territories.sort((a, b) => a.id.localeCompare(b.id))

const scCount = territories.filter((t) => t.supplyCenter).length
const tsOut = `import type { MapDefinition } from '../mapDefinition'

// AUTO-GENERATED by tools/variants/1900/build.mjs from the jDip 1900 plugin.
// Do not edit by hand — re-run the converter. Source: tools/variants/1900/source/.
// 1900 variant by Baron M. Powell. ${territories.length} territories, ${scCount} supply centers.

export const map1900: MapDefinition = {
  id: '1900',
  name: '1900',
  description: "Baron M. Powell's 1900 — historically tuned Europe, 7 powers, ${scCount} supply centers",
  playerCount: 7,
  powers: [
${POWERS.map((p) => `    { id: ${q(p.id)}, name: ${q(p.name)}, color: ${q(p.color)} },`).join('\n')}
  ],

  territories: {
${territories.map(emitTerritory).join('\n')}
  },

  startingUnits: [
${starting
    .map(
      (u) =>
        `    { type: ${q(u.type)}, power: ${q(u.power)}, territory: ${q(u.territory)}${u.coast ? `, coast: ${q(u.coast)}` : ''} },`,
    )
    .join('\n')}
  ],
}
`
writeFileSync(repo('src/lib/maps/1900.ts'), tsOut)

// ── 6. emit public/maps/1900.dsvg ────────────────────────────────────────────────
// dSVG ids must be LOWERCASE (+ "base/coast" for named coasts): the renderer looks
// up geometry/positions via toDsvgId(gameId) = gameId.toLowerCase(). For 1900 every
// lowercased game id equals its jDip shortname, so the keys line up exactly.
// This file is PURE DATA — geometry + ids + positions. All colour/font/atmosphere is
// applied procedurally by the renderer (src/lib/map/mapRenderer.ts), so no styling here.
const lc = (id) => id.toLowerCase()
const provincePaths = []
for (const t of territories) {
  const d = fillPath.get(lc(t.id))
  if (d) provincePaths.push(`    <path id="${lc(t.id)}" d="${d}"/>`)
}

// Named coasts: reuse the province geometry, keyed "base/coast" (mirrors classical.dsvg).
const coastPaths = []
for (const t of territories) {
  if (!t.coasts) continue
  const d = fillPath.get(lc(t.id))
  if (!d) continue
  for (const c of Object.keys(t.coasts)) coastPaths.push(`    <path id="${lc(t.id)}/${c}" d="${d}"/>`)
}

// Placement coords are in native ~761 space → scale to the canonical resolution (S).
const pt = (x, y) => `cx="${S(x)}" cy="${S(y)}"`
const unitCircles = []
for (const t of territories) {
  const u = unitPt.get(lc(t.id))
  if (!u) continue
  unitCircles.push(`    <circle id="${lc(t.id)}" ${pt(u.x, u.y)} r="1"/>`)
  // A coastal fleet renders at toDsvgId(prov, coast) = "base/coast". Use the per-coast
  // marker (already scaled), so each coast's fleet sits on the side it faces.
  if (t.coasts) for (const [c, def] of Object.entries(t.coasts)) {
    unitCircles.push(`    <circle id="${lc(t.id)}/${c}" cx="${def.center[0]}" cy="${def.center[1]}" r="1"/>`)
  }
}

const scCircles = territories
  .filter((t) => t.supplyCenter && scPt.has(lc(t.id)))
  .map((t) => {
    const s = scPt.get(lc(t.id))
    return `    <circle id="${lc(t.id)}" ${pt(s.x, s.y)} r="1"/>`
  })

// Province name labels: anchor points only (no font/colour — the renderer themes them).
const nameLabels = territories.map(
  (t) => `    <text id="name-${lc(t.id)}" x="${t.center[0]}" y="${t.center[1]}" text-anchor="middle">${t.name}</text>`,
)

const vb = `${S(viewBox.minX)} ${S(viewBox.minY)} ${S(viewBox.width)} ${S(viewBox.height)}`
const dsvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">
  <defs/>
  <g id="background"/>
  <g id="provinces">
${provincePaths.join('\n')}
  </g>
  <g id="named-coasts">
${coastPaths.join('\n')}
  </g>
  <g id="unit-positions">
${unitCircles.join('\n')}
  </g>
  <g id="supply-centers">
${scCircles.join('\n')}
  </g>
  <g id="province-names">
${nameLabels.join('\n')}
  </g>
  <g id="borders"/>
  <g id="foreground"/>
</svg>
`
writeFileSync(repo('public/maps/1900.dsvg'), dsvg)

console.log(
  `✅ wrote src/lib/maps/1900.ts and public/maps/1900.dsvg\n` +
    `   ${territories.length} territories, ${scCount} SCs, ${starting.length} starting units, ` +
    `${provincePaths.length} province paths, ${unitCircles.length} unit dots`,
)
