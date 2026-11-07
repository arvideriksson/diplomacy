# Era of Empire board generation

`npm run map:era` deterministically writes `public/maps/era.dsvg` and `src/lib/maps/era.ts`
from `source/geometry.json`; neither generated file should be edited by hand.

`build.mjs` reuses the 1900 board's artwork (`../1900/artwork.mjs`, shared-edge chains), so
the board matches the classical and 1900 style; the geometry helpers (`../lib/geom.mjs`) and the
finishing steps — dSVG layers, `placements.json` checks, map-definition file — are shared with
the 1900 build (`../lib/board.mjs`). `build.mjs` also tidies the traced shapes: borders between two seas are smoothed (their ends
stay put), as is Cebu's water ring against the open seas (not along Manila's and Davao's
coasts), and specks among Cebu's islands become water; zero-width spikes are removed; detached slivers
of a sea go to the sea they touch most, specks of land to what surrounds them, and an islet
touching its own province joins it. Spots that still draw badly are patched by hand in
`layout.mjs` (`CEBU_WATER`, `LAND_PATCHES`). Labels come from `../lib/labels.mjs` (shared with the 1900 board): each name goes as
near its province's visual centre as it fits, at the largest size that fits, upright or tilted
along a long province, on one to three lines. Small provinces whose name only fits small put it
in the water beside them. Label widths come from `../lib/advances.json`, the glyph advances of the
embedded Libre Baskerville (regular, bold, italic) measured in a browser by
`../lib/measure-advances.mjs` (`--check` re-measures and compares). `layout.mjs` holds hand placement: per-label
hints (centre targets, allowed angles, Constantinople's name reaching into the Black Sea), a
supply center, and the impassable islets (north of New Guinea, off Mombasa).
The movement graph is read off the drawn borders, plus the strait arrows and the Nepal–Punjab
corner; the rulebook's examples are locked in `src/lib/maps/era.test.ts`. Powers, setup, the
1870 start and the 22-center target come from the official Era of Empire rulebook.

## Tracing (`trace/`)

`source/geometry.json` was traced from three images of the published board (not committed):
the flat board inside the rulebook PDF (coastlines, sea borders), the BoardGameGeek image
8484359 (land borders) and the 3484px BGG photo 8979352 (land vs water for islets and straits).
To re-trace, put them in `$ERA_TRACE_DIR/src/` (`p6-000.jpg`, `eoe.jpg`, `board_hi.jpg`) and run,
with opencv, scikit-image, scikit-learn and shapely installed:

    register.py; register.py photo; densereg.py; ridge.py; landsea.py; segment.py; vectorize.py

The scripts work in `$ERA_TRACE_DIR/work/` (default `trace/_work/`, gitignored). Two steps are
not in the committed code:

- `vectorize.py` reads `work/stars.json`, the supply-center stars found by template matching on
  the registered board (a list of `[x, y, score]` in board-image pixels; matches scoring above
  0.36 are used, and Tokyo, Otaru and Bangkok are placed by hand in `vectorize.py`). No
  committed script writes it; it has to be recreated before a re-trace.
- `vectorize.py` writes `work/geometry.json`; copy it to `source/geometry.json` by hand, then
  run `npm run map:era`.

`straitfix.py`, `gaps.py` and `hatch.py` are helpers imported by `segment.py`.

`seeds.py` holds everything hand-traced: province seeds, strait arrows, and the water/land
polygons and boxes used where labels, arrows or photo glare hide the coast.
