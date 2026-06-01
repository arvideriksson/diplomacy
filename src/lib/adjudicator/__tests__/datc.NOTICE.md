# DATC corpus provenance

`datc.json` is vendored verbatim from **TedDriggs/diplomacy**:

- Source: https://raw.githubusercontent.com/TedDriggs/diplomacy/master/diplotest/datc.json
- License: **MIT** © Ted Driggs
- Fetched: 2026-06 (171 cases)

It encodes the Diplomacy Adjudicator Test Cases (DATC v3.0, Lucas Kruijswijk).

Notes on the format vs. our engine:

- Province codes are **lowercase** (`nth`, `pic`); coasts are `spa(nc)`. We map these
  to our UPPERCASE keys in `datc-codes.ts` (only `lyo→GOL` and `nwy→NOR` differ).
- Assertions are **per-order** `"Succeeds" | "Fails" | null` (null = setup-only).
  We map our richer result codes onto this: `succeeds` ⇄ `Succeeds`, everything
  else (`fails`/`void`/`bounced`/`dislodged`) ⇄ `Fails`.
- Some cases carry an `"ignore"` field (corpus-declared unrunnable, e.g. illegal
  retreat-phase supports); the harness honors it. Engine-specific divergences go
  in `datc-allowlist.ts` with a reason.
