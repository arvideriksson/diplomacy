// Turn the classical partition into the 1900 partition. Unchanged provinces keep
// their classical outlines exactly; each 1900 change is an explicit edit below.
// Coordinates are classical board units.
import { union, intersect, subtract, poly, sidePolygon, buffer, simplify, wiggle, curve, contains, area, boundaryDistance } from './lib/geom.mjs'
import { sharedEdges } from './lib/edges.mjs'
import { southernLand, southernProvinces } from './south.mjs'
import { transform, box, region, affine } from './lib/natural.mjs'
import { geoConicEquidistant } from 'd3-geo'

// Classical Russia is drawn far from true scale; map real places onto it with an
// affine fit from cities to the classical supply centers and unit anchors.
function russianFrame(classical) {
  const conic = geoConicEquidistant().parallels([45, 60]).rotate([-35, 0]).scale(1000).translate([0, 0])
  const at = (id) => classical.centers.find((p) => contains(classical.provinces[id], p)) ?? classical.units[id]
  const pairs = [[[37.62, 55.75], 'mos'], [[30.3, 59.94], 'stp'], [[33.52, 44.6], 'sev'], [[21.0, 52.23], 'war'], [[26.1, 44.43], 'rum'], [[30.52, 50.45], 'ukr'], [[24.1, 56.95], 'lvn'], [[24.94, 60.17], 'fin']]
  const fit = affine(pairs.map(([ll, id]) => [conic(ll), at(id)]))
  return (ll) => fit(conic(ll))
}

const RENAMES = { hol: 'net', ruh: 'col', lvn: 'lvo', smy: 'kon', syr: 'dam', bot: 'gbo', gol: 'gly', nao: 'nat', nrg: 'nws', mao: 'mid' }
// Classical unplayable islands that become 1900 provinces, found by an interior point.
const PLAYABLE_ISLANDS = { ice: [268, 153], ire: [274, 620], swi: [568, 914] }

// The part of `from` within r of its border with `toward`, as one geometry.
// `taperFrom`, if given, narrows the strip to a third near that point.
const strip = (P, from, toward, r, taperFrom) => {
  const lines = sharedEdges({ [from]: P[from], [toward]: P[toward] }).chains.filter((c) => c.id === from && c.other === toward).map((c) => simplify(c.points, 0.8))
  if (!lines.length) throw new Error(`No ${from}|${toward} border to follow`)
  const radius = (line) => !taperFrom ? r : (i) => {
    const d = Math.hypot(line[i][0] - taperFrom[0], line[i][1] - taperFrom[1])
    return r * (0.3 + 0.7 * Math.min(1, d / 30))
  }
  return intersect(P[from], union(...lines.map((l) => buffer(l, radius(l)))))
}

// Move `piece` (already clipped to its sources) into province `to`.
const move = (P, piece, to, from) => {
  for (const id of from) P[id] = subtract(P[id], piece)
  P[to] = union(P[to] ?? [], piece)
}

// The Kattegat between the Skagerrak and the Baltic belongs to no sea province (the two
// are not adjacent); classical marks its edges with dashed lines, which are reused as is.
const KATTEGAT = poly([[668, 586], [745, 586], [745, 622], [700, 640], [664, 660], [664, 600]])
export const KATTEGAT_LINES = ['Path-26', 'Path-22']

export function europe(classical) {
  const P = {}
  for (const [id, g] of Object.entries(classical.provinces)) P[RENAMES[id] ?? id] = g
  for (const [id, at] of Object.entries(PLAYABLE_ISLANDS)) P[id] = classical.islands.find((g) => contains(g, at))

  // The open water among the Danish islands is unassigned in classical; it is the Baltic's.
  const straits = subtract(poly([[624, 590], [745, 590], [745, 675], [624, 675]]), ...Object.values(P), ...classical.islands, KATTEGAT)
  P.bal = union(P.bal, straits)

  // Ireland becomes playable and touches the Mid-Atlantic: the Mid-Atlantic's
  // northern border now meets Ireland's south-west coast.
  const midNorth = poly([...curve([[-5, 700], [80, 690], [150, 672], [199, 650]]), ...curve([[238, 663], [205, 690], [172, 716]]), [-5, 760]])
  move(P, intersect(union(P.nat, P.iri), midNorth), 'mid', ['nat', 'iri'])

  // The Netherlands gets room for its longer name, inland from Cologne and Kiel.
  move(P, union(strip(P, 'col', 'net', 12), strip(P, 'kie', 'net', 10)), 'net', ['col', 'kie'])

  // Rome absorbs Tuscany.
  P.rom = union(P.rom, P.tus); delete P.tus

  // Milan: the eastern part of Piedmont, inland of the coast, so Venetia keeps its full
  // classical width and Piedmont no longer meets Tyrolia or Venetia.
  // Its Piedmont border follows the real one: down Lake Maggiore and the Ticino, then west
  // around the Lomellina and south into the Oltrepò Pavese.
  const milan = poly(wiggle([[572, 922], [670, 922], [670, 1036], [628, 1036], [610, 1014], [598, 997], [592, 989], [584, 985], [579, 977], [582, 968], [580, 959], [576, 951], [578, 941], [574, 932], [572, 922]], { amplitude: 1.3, seed: 3 }))
  P.mil = intersect(P.pie, milan); P.pie = subtract(P.pie, milan)
  // Milan also takes inland Emilia (the western tail of classical Venice), and Venetia
  // takes Trentino from Tyrolia,
  // so neither is a sliver.
  // (first clearing a hairline spike of Rome/Piedmont that pokes into it)
  move(P, intersect(union(P.ven, P.rom), poly(wiggle([[600, 985], [655, 985], [668, 1000], [672, 1020], [668, 1040], [655, 1052], [640, 1050], [622, 1025], [600, 1000]], { amplitude: 2, seed: 17 }))), 'mil', ['ven', 'rom'])
  move(P, intersect(union(P.pie, P.rom), poly([[600, 996], [616, 996], [614, 1006], [606, 1007]])), 'mil', ['pie', 'rom'])
  // Northern Italy after the 1900 board: Milan is Lombardy, under Switzerland and touching
  // Rome only at its southern tip; Venetia runs from Tyrolia across Emilia to the Adriatic;
  // Rome takes everything south of a line from the Ligurian coast to its old Venetia border
  // (which keeps Venetia on Apulia), so it has a clear border with Piedmont.
  const italy = union(P.mil, P.ven, P.rom)
  const lombardy = intersect(italy, poly([[560, 900], [662, 900], ...wiggle([[662, 950], [660, 968], [650, 982], [634, 990], [618, 994], [604, 992]], { amplitude: 1.4, seed: 23 }), [590, 990], [560, 960]]))
  const rome = subtract(intersect(italy, poly([[560, 1200], [560, 986], ...wiggle([[590, 986], [604, 988], [618, 990], [636, 1004], [656, 1024], [669, 1037]], { amplitude: 1.6, seed: 31 }), [674, 1039], [681, 1054], [690, 1059], [700, 1064], [704.8, 1078.4], [712, 1074.5], [718.5, 1071.5], [760, 1072], [800, 1200]])), lombardy)
  P.mil = lombardy; P.rom = rome; P.ven = subtract(italy, lombardy, rome)
  move(P, intersect(P.tyr, poly([[640, 960], ...wiggle([[648, 942], [668, 935], [690, 934], [712, 940], [732, 952]], { amplitude: 2.5, seed: 19 }), [740, 990], [640, 990]])), 'ven', ['tyr'])

  // Alsace: the strip of Burgundy along its Ruhr and Munich borders.
  const alsace = sidePolygon([[534, 802], [522, 818], [510, 835], [502, 855], [502, 872], [506, 890], [516, 906], [534, 918]], [[600, 918], [600, 790]], { amplitude: 1.8, seed: 9 })
  move(P, intersect(P.bur, alsace), 'als', ['bur'])
  // Burgundy's northern neck (its link to Belgium and Picardy) is widened from Paris
  // and Picardy so it is not a sliver.
  const neck = poly([[440, 780], [530, 780], [530, 875], [440, 875]])
  move(P, intersect(union(strip(P, 'par', 'bur', 16), strip(P, 'pic', 'bur', 10)), neck), 'bur', ['par', 'pic'])

  // Budapest takes Vienna's northern edge so it reaches Bohemia and Vienna no longer touches Galicia.
  move(P, strip(P, 'vie', 'gal', 13), 'bud', ['vie'])

  // Bosnia: the southern part of Trieste (Dalmatia and Bosnia-Herzegovina) and Serbia's western margin.
  const bosnia = sidePolygon([[798, 1050], [812, 1036], [832, 1026], [854, 1024], [872, 1032], [886, 1056], [882, 1088], [866, 1106]], [[840, 1125], [770, 1080]], { amplitude: 1.8, seed: 7 })
  P.bos = union(intersect(P.tri, bosnia), intersect(P.ser, bosnia)); P.tri = subtract(P.tri, bosnia); P.ser = subtract(P.ser, bosnia)
  // Albania's northern arm between Bosnia and Serbia goes to Bosnia.
  move(P, intersect(P.alb, poly([[830, 1055], [905, 1055], ...wiggle([[905, 1092], [885, 1100], [860, 1095], [830, 1104]], { amplitude: 2.5, seed: 23 })])), 'bos', ['alb'])

  // Macedonia: Albania, northern Greece and Bulgaria's Aegean shore, reaching Constantinople.
  P.mac = P.alb; delete P.alb
  move(P, union(strip(P, 'gre', 'ser', 40), strip(P, 'gre', 'bul', 40)), 'mac', ['gre'])
  move(P, strip(P, 'bul', 'aeg', 27), 'mac', ['bul'])

  // Siberia: Russia from the Volga oblasts eastward (Kostroma, Nizhny Novgorod, Penza,
  // Volgograd, ...), carried onto classical Russia by an affine fit to its cities, taken from
  // Moscow and the eastern edges of St. Petersburg and Sevastopol.
  const russia = russianFrame(classical)
  const east = transform(region((c, n, [lon, lat]) => c === 'Russia' && lon > 43 && lat > 48.5 && lat < 66), russia)
  const siberia = east
  for (const id of ['stp', 'mos', 'sev']) { const part = intersect(P[id], siberia); P[id] = subtract(P[id], siberia); P.sib = union(P.sib ?? [], part) }
  // The Nenets okrug (centred north of 66°N) stays with St. Petersburg, so Siberia's
  // northern edge follows their real border instead of a drawn cut.

  // Gibraltar: a small tip of Spain around the Rock and Tarifa, plus a broad strait reaching
  // into the Atlantic and the Alboran Sea, separating the Mid-Atlantic from the Western
  // Mediterranean.
  let gibLand = intersect(P.spa, poly(wiggle([[118, 1176], [134, 1184], [150, 1189], [166, 1191], [178, 1196], [184, 1206], [186, 1226], [118, 1226]], { amplitude: 1.5, seed: 29 })))
  // The strait itself is open water between the tip and Morocco.
  const channel = poly([[144, 1219], [158, 1219], [158, 1229], [144, 1229]])
  const strait = union(intersect(gibLand, channel), intersect(P.naf, channel))
  P.naf = subtract(P.naf, channel)
  gibLand = subtract(gibLand, strait)
  const gibSea = union(strait, intersect(union(P.mid, P.wes), poly(curve([[128, 1176], [116, 1204], [116, 1228], [126, 1248], [150, 1292]]).concat(curve([[238, 1292], [256, 1264], [264, 1238], [258, 1212], [242, 1190]]), [[160, 1180]]))))
  P.spa = subtract(P.spa, gibLand, strait); P.mid = subtract(P.mid, gibSea); P.wes = subtract(P.wes, gibSea)
  P.gib = union(gibLand, gibSea)

  // Tunisia no longer touches the Western Mediterranean: the Tyrrhenian takes the
  // water south of Sardinia so the sea border meets the Algerian coast.
  move(P, intersect(P.wes, poly([[576, 1196], [600, 1258], [605, 1300], [512, 1300], [520, 1262], [541, 1244], [561, 1223]])), 'tys', ['wes'])

  return { provinces: P, gibraltarStrait: gibSea }
}

export { RENAMES, PLAYABLE_ISLANDS }

const SEAS = new Set('adr aeg bal bar bla eas eng gbo gly hel ion iri mid nat nth nws ska tys wes'.split(' '))

// The classical point where two provinces' shared border reaches lowest.
const lowestShared = (P, a, b) => sharedEdges({ [a]: P[a], [b]: P[b] }).chains.filter((c) => c.id === a && c.other === b).flatMap((c) => c.points).reduce((m, p) => (p[1] > m[1] ? p : m), [0, -Infinity])

export function extendSouth(P, classical, height) {
  const { width } = classical
  const classicalIds = Object.keys(classical.provinces)
  const landIds = classicalIds.filter((id) => !SEAS.has(RENAMES[id] ?? id))
  const { land, toBoard } = southernLand(classical, landIds, { width, height })
  // Everything the classical board already covers near its bottom edge.
  const band = poly([[-40, 1290], [width + 40, 1290], [width + 40, 1400], [-40, 1400]])
  const covered = union(...[...Object.values(classical.provinces), ...classical.islands].map((g) => intersect(g, band)))
  const below = subtract(poly([[-40, 1352], [width + 40, 1352], [width + 40, height + 40], [-40, height + 40]]), covered)
  const extLand = intersect(land, below)
  // The Gulf of Aqaba's arm north of the Sinai crossing point belongs to no sea, so the
  // Red Sea (Mid) does not reach its head.
  const aqaba = transform(box(34.3, 28.3, 35.2, 29.7), toBoard)
  const extWater = subtract(below, land, aqaba)
  const real = southernProvinces(toBoard)
  // Classical North Africa splits at the real Morocco–Algeria border (which meets
  // the sea at Saïdia, 2.2°W); north of the real coast the line continues due north.
  // West of the real Atlantic coast the classical coast lies further out; that land is Moroccan too.
  const morocco = union(real.mor, transform(union(box(-20, 34.9, -2.2, 40), box(-20, 29.5, -6, 34.9)), toBoard))
  P.mor = intersect(P.naf, morocco); P.alg = subtract(P.naf, morocco); delete P.naf
  // Southern Algeria's real northern border also cuts classical North Africa, so the
  // Algeria/Southern Algeria border is not the old board edge.
  move(P, intersect(P.alg, real.sou), 'sou', ['alg'])
  // Tunisia is widened westward so it is not a sliver.
  // Tunisia's western border follows the real (modern) border, also across classical North Africa.
  move(P, intersect(P.alg, real.tun), 'tun', ['alg'])
  move(P, intersect(P.tun, real.alg), 'alg', ['tun'])
  // Likewise the real Syria–Iraq border cuts classical Syria (Damascus).
  // (stopping short of Armenia, which Arabia must not touch).
  // Palestine extends north to about 33°N (Galilee and the Golan), so it borders Damascus properly.
  move(P, intersect(P.dam, transform(box(34, 31, 36.4, 33.1), toBoard)), 'pal', ['dam'])

  move(P, intersect(P.dam, intersect(real.ara, poly([[1420, 1370], [width + 40, 1285], [width + 40, 1500], [1420, 1500]]))), 'ara', ['dam'])
  // Assign the land below the seam province by province; each takes only what is
  // still unassigned, so neighbours share their borders exactly.
  let unassigned = extLand
  for (const id of ['egy', 'pal', 'hej', 'dam', 'ara', 'tun', 'trp', 'cyr', 'alg', 'sou', 'mor']) {
    const piece = intersect(unassigned, real[id])
    P[id] = union(P[id] ?? [], piece); unassigned = subtract(unassigned, piece)
  }
  // Slivers between the real borders and the coast join the coastal province they
  // hug most (or failing that, the nearest one).
  const coastal = Object.keys(real).filter((id) => !['ara', 'sou'].includes(id))
  for (const piece of unassigned) {
    const touch = (id) => piece[0].filter((p) => boundaryDistance(P[id], p) < 1).length
    const gap = (id) => boundaryDistance(P[id], piece[0][0])
    const best = coastal.reduce((a, b) => (touch(b) > touch(a) || (touch(b) === touch(a) && gap(b) < gap(a)) ? b : a))
    P[best] = union(P[best], [piece])
  }
  // Water: the Atlantic off Morocco and the Red Sea (south of the Suez isthmus) are
  // Mid-Atlantic; the rest continues the Ionian and Eastern Mediterranean.
  const atlantic = poly([[-40, 1300], [300, 1300], [300, height + 40], [-40, height + 40]])
  const redSea = poly([[1200, 1475], [width + 40, 1475], [width + 40, height + 40], [1200, height + 40]])
  move(P, intersect(extWater, union(atlantic, redSea)), 'mid', [])
  const rest = subtract(extWater, atlantic, redSea)
  const [ix] = lowestShared(P, 'ion', 'eas')
  const ionSide = poly([[-40, 1300], [ix, 1300], ...curve([[ix, 1357], [ix - 20, 1420], [1000, 1460]]), [1000, height + 40], [-40, height + 40]])
  move(P, intersect(rest, ionSide), 'ion', [])
  move(P, subtract(rest, ionSide), 'eas', [])
  // Clip everything to the board.
  const board = poly([[0, 0], [width, 0], [width, height], [0, height]])
  for (const id of Object.keys(P)) P[id] = intersect(P[id], board)
  return { provinces: P, project: toBoard }
}

const bbox = (g) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of g) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0, y0, x1, y1]
}

// Classical draws sea borders separately from coasts, which leaves hairline
// unassigned slivers. Give each sliver to the neighbour it hugs most; keep
// larger unassigned areas (lakes, the Sea of Marmara) as drawn holes.
export function fillSlivers(P, islands, width, height, tile = 160) {
  const boxes = Object.fromEntries(Object.entries(P).map(([id, g]) => [id, bbox(g)]))
  const lakes = []
  for (let tx = 0; tx < width; tx += tile) for (let ty = 0; ty < height; ty += tile) {
    const rect = poly([[tx, ty], [Math.min(width, tx + tile), ty], [Math.min(width, tx + tile), Math.min(height, ty + tile)], [tx, Math.min(height, ty + tile)]])
    const near = Object.keys(P).filter((id) => { const [a, b, c, d] = boxes[id]; return a <= tx + tile + 1 && c >= tx - 1 && b <= ty + tile + 1 && d >= ty - 1 })
    const left = subtract(rect, ...near.map((id) => intersect(P[id], rect)), ...islands.map((g) => intersect(g, rect)))
    for (const piece of left) {
      const a = area([piece]), perimeter = piece[0].reduce((s, p, i, r) => s + Math.hypot(...[0, 1].map((k) => r[(i + 1) % r.length][k] - p[k])), 0)
      if (a < 0.01) continue
      if (a / perimeter > 1.5) { lakes.push([piece]); continue }
      let best = null, bestScore = -1
      for (const id of near) {
        const score = piece[0].filter((p) => boundaryDistance(P[id], p) < 0.6).length
        if (score > bestScore) { best = id; bestScore = score }
      }
      if (best) P[best] = union(P[best], [piece])
    }
  }
  return union(...lakes)
}

// Tidy-ups that must run after the sliver fill.
export function finalTouches(P) {
  // The North Atlantic / Irish Sea line between Ireland and Liverpool runs smoothly
  // (classical bends it around a small rock).
  move(P, intersect(P.nat, poly([[331, 599.5], [356, 602.5], [356, 614], [331, 614]])), 'iri', ['nat'])
}
