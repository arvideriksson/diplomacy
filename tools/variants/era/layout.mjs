// Hand placement for the Era of Empire board. Coordinates are board units; angles are degrees.

// Label overrides by province id (see labels.mjs): text (use \n for a line break), target (the
// point to centre on), size, minSize, margin, angles, upright, across (a name in the water may also cross the coast into the province), within (how far a name in the water may sit from the province centre), spill ('first': in the water beside it, placed before the sea names; false: never), or
// fixed with at and angle to place it exactly.
export const LABELS = {
  // Constantinople is a wedge at the board's edge: its name runs along it, just reaching the
  // Black Sea's western tip, leaving the sea its own label.
  CON: { fixed: true, at: [72, 310], angle: 0, size: 17 },
  BS: { minSize: 10, margin: 4 },
  // Upright or nearly so reads better than the steep tilt these shapes would otherwise get.
  RUM: { angles: [0, -5, -10] },
  HK: { angles: [0] },
  NG: { angles: [0, -5, -10, -15, -20] },
  SCS: { angles: [0, -5, 5, -10, 10] },
  // Visual centres the automatic one misses (an awkward lobe, or the supply centre in the way).
  TIB: { target: [1215, 552] },
  MYS: { target: [1003, 885], angles: [0, -45, -50, -55, -60, -65] },
  MOM: { target: [190, 1255], angles: [0] },
  PER: { target: [605, 505] },
  SUM: { target: [1572, 1188] },
  YS: { target: [1930, 505] },
  BOK: { target: [660, 355] },
  MAA: { target: [140, 1238] },
  WIO: { target: [865, 1058], within: 40 },
  EIO: { target: [1305, 1100], within: 40 },
  PA: { minSize: 17, margin: 2, spill: false, angles: [0, -5, 5, -10, 10] },
}

// Like 1900: capitals of the great powers, and the independent nations.
export const BOLD_NAMES = new Set(['Delhi', 'Peking', 'Tonkin', 'Tokyo', 'Java', 'Moscow', 'Constantinople', 'Persia', 'Corea', 'Rumania', 'Bangkok'])

// Unit anchors placed by hand (otherwise the most open spot of the province).
export const UNITS = {}

// Islets north of New Guinea and the one off Mombasa are unplayable (striped); every other islet belongs to its nearest
// province. A box in board units around them.
export const IMPASSABLE_ISLETS = [[2085, 1060, 2210, 1185], [320, 1370, 385, 1430]]  // north of New Guinea; off Mombasa

// Supply centers moved by hand to make room for a small province's name.
export const CENTER_AT = { CON: [19, 285], PA: [1790, 320] }

// Water given to Cebu's ring by hand: the channel between Manila and the islet off its tip (so
// one short sea line closes its mouth), and the strip of sea between the ring and Davao's coast.
export const CEBU_WATER = [
  [[2003, 819.5], [2012.5, 819.5], [2012.5, 830], [2003, 830]],
  [[2017, 915], [2030, 905], [2050, 897], [2066, 889], [2066, 907], [2050, 913], [2035, 918], [2020, 923]],
]

// Water (a sea's, or Cebu's ring) given to land by hand, where the tracing left a shape that draws badly: a needle-thin
// inlet, an islet a hair off its own coast, an islet cut flat by a straight sea border.
export const LAND_PATCHES = [
  { owner: 'SAR', poly: [[1898, 1016.2], [1905, 1015.6], [1907.4, 1015], [1911.2, 1017.6], [1911.8, 1018.6], [1909, 1018.6], [1905.4, 1017.9], [1899.6, 1017.3]] },  // inlet, north-east Sarawak
  { owner: 'SAR', poly: [[1886, 1019.2], [1887.4, 1019.2], [1890.4, 1021.8], [1891.6, 1024.6], [1893.4, 1026.3], [1891.6, 1027.6], [1890.6, 1026.6], [1885.8, 1023]] },  // a second, west of it
  { owner: 'NG', poly: [[2084.5, 1164], [2087, 1164.6], [2089.2, 1167], [2089.2, 1171.5], [2089.6, 1173.6], [2086, 1175.6], [2083.4, 1175.8], [2083.4, 1172.4]] },  // islet against the north coast
  { owner: 'DAV', poly: [[2002, 921.9], [2000.4, 922.75], [2002.1, 923.1]] },  // a one-unit step in the coast below Cebu's ring
  { owner: 'MNA', poly: [[1930.8, 806.2], [1931.2, 800.5], [1936, 800.5], [1936, 808.9], [1935.2, 808.8]] },  // inlet where Cebu's ring meets Manila
  { owner: 'DAV', poly: [[2007, 918], [2004.6, 921.6], [2007.5, 920.5], [2007.5, 918]] },  // bevel Davao's corner where the ring meets it
  { owner: 'SUM', poly: [[1511, 1181], [1517, 1181.6], [1517, 1182.6], [1520, 1183.6], [1523.2, 1182.6], [1523, 1185], [1520, 1186.2], [1515, 1185.4], [1511.4, 1183.2]] },  // islet on the Indian Ocean border
]

// Water moved between provinces by hand: the wedge of Cebu's ring below its smooth edge at
// Davao's north-west corner (its straight side drew as a stub); the ring now meets the coast.
export const WATER_PATCHES = [
  { from: 'CEB', to: 'SCS', poly: [[2001.5, 918.97], [2003.17, 918.87], [2007, 918], [2008, 917.8], [2008, 923], [2001.5, 923]] },
]
