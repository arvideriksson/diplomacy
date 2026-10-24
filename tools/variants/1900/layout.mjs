// Hand placement for everything the classical board does not already provide.
// Coordinates are board units; angles are degrees.

// Classical labels that no longer apply (merged, split or renamed provinces and
// Bulgaria's former south coast).
export const DROP_LABELS = new Set(['N. Africa', 'Tunis', 'Tuscany', 'Venice', 'Albania', 'Holland', 'Ruhr', 'Smyrna', 'Syria', 'LVN', 'Livonia', 'Greece', 'Trieste', 'Burgundy', 'Rome', 'Piedmont', 'Sevastopol', 'LVP'])
// Classical coast markers to drop, identified by text and approximate position.
export const DROP_COAST_MARKS = [['SC', [1005, 1117]], ['EC', [1071, 1033]], ['SC', [220, 1204]]]

// New and replacement labels. kind: sc (bold), land (italic), sea (italic caps).
export const LABELS = {
  net: { text: 'Netherlands', at: [546, 716], angle: -33, size: 13, fixed: true, kind: 'sc' },
  col: { text: 'Cologne', at: [580, 800], angle: -70, size: 14, kind: 'sc' },
  als: { text: 'Alsace', at: [534, 860], angle: -80, size: 14, kind: 'land' },
  bur: { text: 'Burgundy', at: [478, 905], angle: -51, kind: 'land' },
  swi: { text: 'Switzerland', at: [575, 920], angle: 0, size: 11, fixed: true, kind: 'sc' },
  mil: { text: 'Milan', at: [614, 952], angle: 0, size: 14, kind: 'sc' },
  pie: { text: 'Piedmont', at: [548, 975], angle: -3, kind: 'land' },
  rom: { text: 'Rome', at: [662, 1060], angle: 46, kind: 'sc' },
  ven: { text: 'Venetia', at: [664, 1016], angle: 56, size: 13, fixed: true, kind: 'land' },
  tri: { text: 'Trieste', at: [797, 1025], angle: 38, size: 15, kind: 'sc' },
  bos: { text: 'Bosnia', at: [842, 1058], angle: 20, size: 14, kind: 'land' },
  mac: { text: 'Macedonia', at: [912, 1150], angle: -4, size: 13, kind: 'land' },
  gre: { text: 'Greece', at: [935, 1218], angle: 0, size: 14, kind: 'sc' },
  lvo: { text: 'Livonia', at: [962, 562], angle: 0, kind: 'land' },
  kon: { text: 'Konya', at: [1231, 1199], angle: -11, kind: 'land' },
  dam: { text: 'Damascus', at: [1405, 1262], angle: 0, kind: 'sc' },
  sev: { text: 'Sevastopol', at: [1330, 820], angle: 0, kind: 'sc' },
  sib: { text: 'Siberia', at: [1428, 345], angle: 0, angles: [0], kind: 'land' },
  gib: { text: 'Gibraltar', at: [206, 1235], angle: 9, fixed: true, kind: 'land' },
  ice: { text: 'Iceland', at: [280, 150], angle: -10, angles: [-10, -8, -12], kind: 'land' },
  ire: { text: 'Ireland', at: [276, 608], angle: -40, kind: 'land' },
  mor: { text: 'Morocco', at: [130, 1395], angle: 0, kind: 'sc' },
  alg: { text: 'Algeria', at: [400, 1318], angle: 0, kind: 'sc' },
  tun: { text: 'Tunisia', at: [583, 1323], angle: 1, kind: 'land' },
  sou: { text: 'Southern Algeria', at: [330, 1510], angle: 0, kind: 'land' },
  trp: { text: 'Tripolitania', at: [720, 1500], angle: 0, kind: 'sc' },
  cyr: { text: 'Cyrenaica', at: [960, 1520], angle: 0, kind: 'land' },
  egy: { text: 'Egypt', at: [1175, 1520], angle: 0, kind: 'sc' },
  pal: { text: 'Palestine', angle: -60, size: 13, kind: 'land' },
  ara: { text: 'Arabia', angle: 0, angles: [0], kind: 'land' },
  hej: { text: 'Hejaz', angle: 40, angles: [40, 35, 45, 30, 50], kind: 'land' },
}

// Coast markers in the classical style (small bold caps).
export const COAST_MARKS = [
  { text: 'WC', at: [134, 1160], angle: 62 },
  { text: 'EC', at: [345, 1095], angle: -40 },
  { text: 'WC', at: [879, 1133], angle: 0 },
  { text: 'EC', at: [972, 1121], angle: 0 },
]

// Supply-center names set in bold: the great powers' capitals (Budapest as Austria-Hungary's
// second capital) and the independent nations. Other home centers, colonies and Ottoman
// provinces are regular, as are classical's odd ones out (Warsaw, the LVP abbreviation).
export const BOLD_NAMES = new Set([
  'London', 'Paris', 'Berlin', 'Vienna', 'Budapest', 'Rome', 'Constantinople', 'St. Petersburg',
  'Portugal', 'Spain', 'Morocco', 'Belgium', 'Netherlands', 'Denmark', 'Sweden', 'Norway', 'Switzerland',
  'Serbia', 'Rumania', 'Bulgaria', 'Greece',
])

// Supply centers that are new in 1900 or sit in reshaped provinces.
export const CENTERS = {
  col: [575, 790], net: [558, 714], swi: [566, 902], alg: [400, 1290], mor: [138, 1360], trp: [712, 1472], mil: [626, 976], 
  egy: [1210, 1490], dam: [1405, 1292],
}

// Unit anchors that classical does not provide (or that moved).
export const UNITS = {
  col: [556, 812], als: [538, 870], swi: [597, 912], mil: [646, 962], 
  rom: [690, 1110], mac: [905, 1140], 'mac/wc': [868, 1150], 'mac/ec': [972, 1128], gre: [925, 1215],
  lvo: [945, 600], ice: [262, 180], ire: [262, 640], sib: [1470, 430],
  mor: [110, 1380], alg: [455, 1318], tun: [600, 1330], sou: [330, 1470], cyr: [960, 1490],
  egy: [1175, 1490], pal: [1352, 1460], dam: [1440, 1320], kon: [1240, 1240],
  'spa/wc': [122, 1160], ven: [700, 960], gib: [158, 1205], 'spa/ec': [300, 1150], bur: [470, 930], tri: [800, 1030],
}

// The Red Sea is part of the Mid-Atlantic (the long route round Africa): instead of a
// name it carries a note and an arrow along the sea, pointing off the board.
// Its centre line is fitted from the shores between rows `span` (east of x = `from`); the text
// and arrow are placed at distances along that line from its middle.
export const RED_SEA_NOTE = { text: 'To MID', from: 1310, span: [1560, 1618], textAt: -12, arrow: [10, 30] }
// Moves from the Mid-Atlantic to Egypt and Hejaz go round Africa: a note off Morocco's
// Atlantic coast (fitted between x = `span`), `offset` units out to sea, points south-west.
// The long route's arrows come back on board at the west edge and run this far in before
// curving to the Mid-Atlantic unit.
export const LONG_ROUTE = { offBoard: 80, fromBottom: 0.3 }
export const MOROCCO_NOTE = { text: 'To Egypt, Hejaz', span: [8, 136], textAt: -12, arrow: [28, 52], offset: 16, tilt: 6 }

// Army crossings over water, drawn as dashed double-headed arrows.
export const CROSSING_ARROWS = [
  [[322, 582], [352, 574]], // Ireland – Clyde
  [[147, 1242], [149, 1210]], // Morocco – Gibraltar
]
