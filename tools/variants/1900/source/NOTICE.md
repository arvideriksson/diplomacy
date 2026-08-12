# Source attribution — Diplomacy 1900

These three files are the jDip variant plugin for Baron M. Powell's **1900** variant,
extracted verbatim from `variants/1900Variants.zip` in the jDip project
(https://github.com/rgo/jDip), dated 2005. jDip is distributed under the GPL.

- `1900_dipmap.svg`   — vector outline map + `jdipNS:` unit/SC placement data
- `1900_adjacency.xml` — province move/coast adjacency graph (judge format)
- `variants.xml`       — powers, supply centers, starting units, and the full rules text

The 1900 variant was designed by **Baron M. Powell**; the jDip plugin was assembled by
the jDip authors. We reuse this data (with attribution) to generate our own
`public/maps/1900.dsvg` and `src/lib/maps/1900.ts` via `tools/variants/1900/build.mjs`.

Rules of note captured in `variants.xml` (for the adjudicator, handled separately):
Suez half-strength MAO↔Egypt/Hejaz, convoyable Gibraltar (non-SC sea-space),
passable Iceland/Ireland/Switzerland, Clyde↔Ireland direct, no builds in Africa,
Russian Steamroller (+1 unit while holding a home SC — the `dum` dummy SC), 18-SC victory.
