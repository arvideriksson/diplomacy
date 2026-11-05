// Hand placement for the Era of Empire board. Coordinates are board units; angles are degrees.

// Label overrides by province id: text, at (hint), angle, size, fixed (keep exactly), angles.
export const LABELS = {
  // Singapore is a small island: its name sits in the strait below it, as on the published board.
  // Small capitals: upright or nearly so, allowed to shrink further than other labels.
  CON: { at: [38, 316], size: 9, minSize: 7, margin: 1, angles: [0, -10, -20, -30, 10, 20] },
  OMA: { at: [606, 752], angle: 0, size: 15, fixed: true },
  TOK: { minSize: 8, margin: 1.2, angles: [0, -10, 10, -15, 15] },
  // Hong Kong (Hainan) is a small island: its name sits in the sea just below it, as on the board.
  HK: { at: [1770, 787], angle: 0, size: 11, fixed: true },  // in the sea below the island, as on the board
  SIG: { at: [1668, 1171], angle: 0, size: 11, fixed: true },  // in the strait below the island, as on the board
}

// Like 1900: capitals of the great powers, and the independent nations.
export const BOLD_NAMES = new Set(['Delhi', 'Peking', 'Tonkin', 'Tokyo', 'Java', 'Moscow', 'Constantinople', 'Persia', 'Corea', 'Rumania', 'Bangkok'])

// Unit anchors placed by hand (otherwise the most open spot of the province).
export const UNITS = {}

// Islets north of New Guinea and the one off Mombasa are unplayable (striped); every other islet belongs to its nearest
// province. A box in board units around them.
export const IMPASSABLE_ISLETS = [[2085, 1060, 2210, 1185], [320, 1370, 385, 1430]]  // north of New Guinea; off Mombasa

// Supply centers moved by hand to make room for a small province's name.
export const CENTER_AT = { CON: [15, 322] }
