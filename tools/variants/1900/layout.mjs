// Hand placement for everything the classical board does not already provide.
// Coordinates are board units; angles are degrees.

// Classical labels that no longer apply (merged, split or renamed provinces and
// Bulgaria's former south coast).
export const DROP_LABELS = new Set(['N. Africa', 'Tunis', 'Tuscany', 'Venice', 'Albania', 'Holland', 'Ruhr', 'Smyrna', 'Syria', 'LVN', 'Livonia', 'Greece', 'Trieste', 'Burgundy', 'Rome', 'Piedmont', 'Sevastopol'])
// Classical coast markers to drop, identified by text and approximate position.
export const DROP_COAST_MARKS = [['SC', [1005, 1117]], ['EC', [1071, 1033]], ['SC', [220, 1204]]]

// New and replacement labels. kind: sc (bold), land (italic), sea (italic caps).
export const LABELS = {
  net: { text: 'Netherlands', at: [546, 716], angle: -33, size: 13, fixed: true, kind: 'sc' },
  col: { text: 'Cologne', at: [580, 800], angle: -70, size: 14, kind: 'sc' },
  als: { text: 'Alsace', at: [534, 860], angle: -80, size: 14, kind: 'land' },
  bur: { text: 'Burgundy', at: [478, 905], angle: -51, kind: 'land' },
  swi: { text: 'Switzerland', at: [566, 912], angle: 0, angles: [0, -4, 4, -8, 8, -12, 12], size: 14, minSize: 10, free: true, kind: 'sc' },
  mil: { text: 'Milan', at: [628, 970], angle: 0, size: 14, kind: 'sc' },
  pie: { text: 'Piedmont', at: [548, 975], angle: -3, kind: 'land' },
  rom: { text: 'Rome', at: [662, 1060], angle: 46, kind: 'sc' },
  ven: { text: 'Venetia', at: [679, 942], angle: -25, size: 13, kind: 'land' },
  tri: { text: 'Trieste', at: [797, 1025], angle: 38, size: 15, kind: 'sc' },
  bos: { text: 'Bosnia', at: [842, 1058], angle: 20, size: 14, kind: 'land' },
  mac: { text: 'Macedonia', at: [912, 1150], angle: -4, size: 13, kind: 'land' },
  gre: { text: 'Greece', at: [935, 1218], angle: 0, size: 14, kind: 'sc' },
  lvo: { text: 'Livonia', at: [962, 562], angle: 0, kind: 'land' },
  kon: { text: 'Konya', at: [1231, 1199], angle: -11, kind: 'land' },
  dam: { text: 'Damascus', at: [1405, 1262], angle: 0, kind: 'sc' },
  sev: { text: 'Sevastopol', at: [1330, 820], angle: 0, kind: 'sc' },
  sib: { text: 'Siberia', at: [1428, 345], angle: 0, angles: [0], kind: 'land' },
  gib: { text: 'Gibraltar', at: [180, 1192], angle: -4, size: 13, kind: 'land' },
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
  redSea: { text: 'Red Sea (Mid)', at: [1405, 1597], angle: 38, size: 11, kind: 'sea' },
}

// Coast markers in the classical style (small bold caps).
export const COAST_MARKS = [
  { text: 'WC', at: [134, 1160], angle: 62 },
  { text: 'EC', at: [345, 1095], angle: -40 },
  { text: 'WC', at: [879, 1133], angle: 0 },
  { text: 'EC', at: [972, 1121], angle: 0 },
]

// Supply centers that are new in 1900 or sit in reshaped provinces.
export const CENTERS = {
  col: [575, 790], net: [558, 714], swi: 'pole', alg: [400, 1290], mor: [138, 1360], trp: [712, 1472], mil: [648, 1015], 
  egy: [1210, 1490], dam: [1405, 1292],
}

// Unit anchors that classical does not provide (or that moved).
export const UNITS = {
  col: [556, 812], als: [538, 870], swi: [553, 935], 
  rom: [690, 1110], mac: [905, 1140], 'mac/wc': [868, 1150], 'mac/ec': [972, 1128], gre: [925, 1215],
  lvo: [945, 600], ice: [262, 180], ire: [262, 640], sib: [1470, 430],
  mor: [110, 1380], alg: [455, 1318], tun: [600, 1330], sou: [330, 1470], cyr: [960, 1490],
  egy: [1175, 1490], pal: [1352, 1460], dam: [1440, 1320], kon: [1240, 1240],
  'spa/wc': [122, 1160], ven: [700, 960], gib: [200, 1200], 'spa/ec': [300, 1150], bur: [470, 930], tri: [800, 1030],
}

// Army crossings over water, drawn as dashed double-headed arrows.
export const CROSSING_ARROWS = [
  [[306, 541], [332, 533]], // Ireland – Clyde
  [[1328, 1545], [1356, 1545]], // Sinai (Egypt) – Hejaz
]
