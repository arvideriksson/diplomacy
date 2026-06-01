# Adjudicator engine

Pure, deterministic, variant-parameterized Diplomacy order resolver. Isomorphic
(no browser/Node/Deno-specific imports) so the same module runs in the browser
and in the Supabase Edge Function. Implements Kruijswijk's *Math of Adjudication*.

## Contract

```ts
import { adjudicate, foldGame, initialBoard } from './index'

const result = adjudicate(map, boardState, orders)
// result.newBoardState  — board advanced to the next phase with work (no-ops skipped)
// result.results        — per-order outcome { order, code, reason } for the UI
// result.victory        — set when a power reaches the SC majority

const finalBoard = foldGame(map, initialBoard(map), resolvedRoundLog)
```

`adjudicate` is a **pure function**: same inputs → identical output. State is the
fold of `adjudicate` over the resolved-order log (event sourcing).

## Determinism

The single hard rule: never iterate a `Map`/`Set` for anything that affects
results — always sort province ids first (`state.ts` provides the canonical
sorts). This guarantees identical results across runs and machines.

## Phases

- `movement` — holds, moves, supports/cuts, convoys, convoy paradoxes (Szykman
  backup), head-to-head, beleaguered garrison.
- `retreat` — dislodged units retreat or disband; two retreats to one province
  bounce; a unit dislodged by a convoyed army may retreat into the army's origin.
- `build` — builds on owned home centers, removals, deterministic civil disorder.

After a movement phase the engine opens a retreat phase only if a unit was
dislodged, and (after Fall) a build phase only if supply-center counts force
adjustments — no-op phases are skipped.

## Correctness

Validated against the vendored TedDriggs DATC corpus (`__tests__/datc.json`, MIT)
via `npm test`. Current status: **133/171 passing**. Skipped cases are
rule-edition variants, corpus-declared `ignore`s, and the documented limitations
in `__tests__/datc-allowlist.ts` (single-coast fleet adjacency, the convoy-paradox
guessing unwind, explicit via-convoy intent, and build cases needing SC ownership
the corpus does not encode).
