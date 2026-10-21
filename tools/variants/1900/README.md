# 1900 board generation

Run `npm run map:1900` from the repository root. It deterministically writes
`public/maps/1900.dsvg` and `src/lib/maps/1900.ts`; neither generated file should
be edited by hand.

The board is the classical board, extended. `lib/classical.mjs` reads
`public/maps/classical.dsvg` (province polygons, islands, supply-center bullseyes,
unit anchors, named coasts and labels). `edits.mjs` applies only the 1900 changes
(Milan, Alsace, Bosnia, Macedonia, Siberia, Gibraltar, playable Iceland/Ireland/
Switzerland, Rome absorbing Tuscany, ...) and keeps every other classical outline
exactly. `south.mjs` adds North Africa and the Near East from Natural Earth admin-1
borders (`tools/geodata/src`), projected onto the classical board and nudged so the
coast meets the classical coast at its old bottom edge.

`lib/audit.mjs` compares every drawn border with `source/1900_adjacency.xml`; the
build fails on any missing or extra border (crossings such as Clyde–Ireland and
Egypt–Hejaz are declared there). `artwork.mjs` draws the board in the classical style;
new borders are smoothed, classical ones are kept as drawn. `lib/labels.mjs` places
new labels inside their province, clear of borders and symbols; `layout.mjs` holds
hand-placed hints, supply centers, unit anchors, coast marks and crossing arrows.

`source/variants.xml` provides powers, centers, ownership, opening units, the starting
year and the 18-center victory target. Labels use Libre Baskerville (OFL), embedded
from `fonts/`. Source attribution is in `source/NOTICE.md`.
