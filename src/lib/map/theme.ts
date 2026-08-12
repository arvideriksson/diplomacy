// A map's *look*, separate from its *data*. The renderer synthesizes a map's
// atmosphere — sea, land, coastline depth, borders, label typography — procedurally
// from province geometry + this theme, so any variant is presentable from pure data.
// (A dsvg may still carry hand-authored background/foreground art, which overrides the
// procedural atmosphere — see mapRenderer's render().)
//
// The defaults mirror the hand-drawn classical map so procedural variants (1900, …)
// read as the same family: a parchment board where land/sea are told apart by a soft
// coastline shadow and crisp coast outlines rather than by colour, with ownership
// tints layered on top.

export interface MapTheme {
  /** Open-sea fill. Kept close to the land tone — depth comes from the coast shadow. */
  sea: string
  /** Land fill, beneath the translucent ownership tint. */
  land: string
  /** Province border line — a thin uniform stroke on each (overlapping, tiled) province;
   *  the overlap hides the neighbour's stroke so each border reads as one line. */
  border: string
  borderWidth: number
  /** Crisp coast outline where land meets sea. */
  coastline: string
  coastlineWidth: number
  /** Soft dark shadow ringing the coastlines for depth (blurs the land silhouette). */
  coast: { color: string; opacity: number; blur: number; dx: number; dy: number } | null
  /** Province-name typography. The halo keeps labels legible over any fill. */
  label: { family: string; size: number; weight: string; color: string; halo: string; haloWidth: number }
}

export const DEFAULT_THEME: MapTheme = {
  // Warm parchment, like classical (whose whole board is #d4d0ad). Sea is a hair
  // cooler/darker than land so it still reads as water, but stays in the warm family
  // rather than the cold gray that made variants look alien.
  sea: '#cbc5a0',
  land: '#d4d0ad',
  border: '#4a4636',
  borderWidth: 1.1,
  coastline: 'rgba(0, 0, 0, 0.55)',
  coastlineWidth: 1,
  coast: { color: '#000000', opacity: 0.45, blur: 5.5, dx: 0, dy: 0 },
  label: {
    family: "'Libre Baskerville', 'Georgia', serif",
    size: 13,
    weight: '700',
    color: '#2e2a1f',
    halo: '#d4d0ad',
    haloWidth: 2.5,
  },
}
