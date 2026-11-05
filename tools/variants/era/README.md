# Era of Empire board generation

`npm run map:era` deterministically writes `public/maps/era.dsvg` and `src/lib/maps/era.ts`
from `source/geometry.json`; neither generated file should be edited by hand.

`build.mjs` reuses the 1900 board's artwork (`../1900/artwork.mjs`, label placer, shared-edge
chains), so the board matches the classical and 1900 style. `layout.mjs` holds hand placement:
a few labels and supply centers, and the impassable islets (north of New Guinea, off Mombasa).
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

`seeds.py` holds everything hand-traced: province seeds, strait arrows, and the water/land
polygons and boxes used where labels, arrows or photo glare hide the coast.
