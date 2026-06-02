# Diplomacy Web Application

A web application for playing the board game **Diplomacy** online.

## Goals

- **Serverless.** The only backend is Supabase (Postgres + Auth + Realtime + Edge Functions). There is no custom server you host — Edge Functions are Supabase-managed Deno. All game logic and persistence run through Supabase: schema, row-level security, Postgres RPC, and a single adjudicator Edge Function.
- **Visually pleasing.** The interface should look polished and inviting, with a clean, well-styled map and UI.
- **Practical for online play.** Optimized for the real workflow of playing Diplomacy remotely: joining games, submitting orders, resolving turns, and tracking state across players.

## Stack

- **Svelte 5** + **Vite** + **TypeScript** (`svelte-check` for type checking)
- **svelte-routing** for client-side routing
- **@supabase/supabase-js** for database, auth, and realtime
- **Playwright** for visual/browser testing

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run check` — type-check Svelte + TypeScript

## Layout

- `src/components/` — Svelte UI (game map, board, lobby, game list, auth)
- `src/lib/` — application logic
  - `supabase.ts` — Supabase client (configured via `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`)
  - `auth.ts`, `game.ts` — auth and game state
  - `map/` — map rendering (SVG parsing, geometry, render state)
  - `maps/` — board definitions (standard map), parameterizing both the order wizard and the adjudicator
  - `orders/` — order types, legal-move *options*, and the order-entry wizard (legality candidates for entry — **not** an adjudicator)
  - `adjudicator/` — pure, dependency-free TS adjudication engine, parameterized by a `MapDefinition`. Imported by the Edge Function; avoids browser/Node-specific APIs so Deno can run it.
- `supabase/` — backend.
  - numbered SQL migrations (`001_schema.sql`, …). RLS policies and RPC functions live here; apply them in order.
  - `functions/` — Edge Functions (Deno). Houses the single authoritative adjudicator, which imports the engine in `src/lib/adjudicator/`.

## Turn Engine & State Model

Turns execute on a timer (every X hours/days, per `settings.turn_timer`) inside Supabase — Postgres plus **one authoritative adjudicator Edge Function**, no custom server. Postgres holds the order log and schedules; the Edge Function is the only thing that resolves a round and advances the board.

- **Scheduler — `pg_cron` (pure SQL, never adjudicates).** A single Postgres cron job ticks frequently (every 1–5 min) and, for each active game whose deadline has passed (or whose powers are all ready), invokes the adjudicator Edge Function via `pg_net`. One job for all games, not one per game. Use `for update skip locked` so concurrent ticks are safe, and a partial index (`(deadline) where phase = 'active'`) to keep the tick a no-op when nothing is due.
- **Adjudicator — Edge Function (Deno + TS), the single source of truth for resolution.** Runs with the service role. For a due round it: reads that round's orders, resolves them (supports, cuts, convoys, retreats, builds), marks the round `resolved`, advances the phase pointer, sets the next deadline, and **writes the board snapshot**. It is the *only* writer of resolved state. The resolution logic itself is the pure engine in `src/lib/adjudicator/`, parameterized by a `MapDefinition` so it supports any variant. Test it with a TS port of the DATC suite; use `zond/godip` as a behavioral oracle for edge cases.
- **Trust — RLS + secrecy.** Players may write only their *own* orders for the current, unresolved round. Other nations' current-round orders are **unreadable until `resolved` is set** — the `resolved` flag is the simultaneous-reveal gate, and Realtime must not stream unresolved foreign orders. The Edge Function (service role) bypasses RLS and is the sole mutator of the board.
- **Push — Realtime.** Clients subscribe to game changes (see `subscribeToGame`) and receive the new snapshot + revealed orders on each resolution.

### State model — event-sourced log, authoritative snapshot

The append-only order log is the **source of truth**; the snapshot is the **authoritative cache** the Edge Function writes from it.

- Persist every round's orders in an append-only `orders` table keyed by `(game_id, year, season, phase, nation)`, each carrying a `resolved` flag set at adjudication. The full resolved log can always rebuild any board — history scrub, or a rebuild-after-adjudicator-bugfix is just re-running the Edge Function over the log and regenerating snapshots.
- On each resolution the Edge Function writes a **board snapshot** (units, ownership, dislodgements, build counts). **Clients read the snapshot for display — they do not replay the log and there is no client-side adjudicator.** This keeps egress low (a few KB per load vs. the whole log) and keeps a single, authoritative resolver. The order *wizard* still derives legal-move options client-side from the map graph (`src/lib/orders/`); that is entry-time legality, not adjudication.
- The snapshot is a cache derived from the log, **never** the source of truth: if the engine changes, replay the log to regenerate it.

### Resolution fires from two triggers (whichever comes first)

1. **Early — all powers ready.** Players submit/finalize orders and toggle a per-nation `ready` flag (the submit RPC enforces own-nation, current-round only). When **all active powers are `ready`**, the next cron tick sees the game due and invokes the adjudicator.
2. **Backstop — `pg_cron` deadline.** When the deadline passes with powers still unready, resolve with whatever orders exist (missing orders = the unit holds).

### Phase progression — the Edge Function skips no-op phases

Because the Edge Function adjudicated the round, it *knows* what comes next: it opens a **retreat** phase only if a unit was dislodged, and a **build** phase only if supply-center counts force adjustments. No-op phases are skipped outright (no wasted timer window). Each opened phase gets its own deadline.

### Orders are editable until resolution

Submitted orders for the **current, unresolved** round are mutable: a player can change them and toggle `ready` on/off freely up to the moment of resolution. Editing un-readies the nation. Resolved rounds are immutable (they form the replay log). Enforce both in RLS / the submit RPC: writes allowed only for the current round's own nation, rejected once `resolved` is set.

### Free-tier shape (Supabase)

The design is sized to fit Supabase's free tier for ~100 games/month. Two constraints shape the schema:

- **Egress (5 GB):** clients read the small snapshot + Realtime deltas, never the full log — this is why the snapshot exists.
- **Database (500 MB):** the order log grows ~40 MB/month and never shrinks. **Archive completed games** (dump the log to File Storage, delete the rows) so storage stays flat.
- Edge Function invocations (~1 per resolution, ~10k/month) are a rounding error against the 500k free quota. Note free projects pause after ~1 week of inactivity, which stops `pg_cron`.

## Conventions

- Supabase env vars are injected at build time via Vite (`import.meta.env.VITE_*`); production secrets come from GitHub Actions secrets.
- Board-advancing logic lives only in the adjudicator Edge Function (service role); player writes go through RLS-guarded, own-nation order submissions. Never trust the client to mutate game state.
- Diplomacy province notation: **seas in ALL CAPS**, **land in Title Case**, **coasts as `Stp(sc)`**.

## References

- **[johnpooch/diplicity-react](https://github.com/johnpooch/diplicity-react)** — a React Diplomacy client to study for UI/UX patterns (order entry wizard, board interaction, game lifecycle). Good reference for how an online Diplomacy front-end is structured; adapt ideas to our Svelte + Supabase stack rather than copying.
