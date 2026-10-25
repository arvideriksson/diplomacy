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

- `npm run dev` — start the Vite dev server against the **local** Supabase stack (`npm run dev:live` targets the cloud project)
- `npm run build` — production build (live project, from `.env` / CI secrets)
- `npm run preview` — preview the production build
- `npm run check` — type-check Svelte + TypeScript
- `npm run db:start` / `db:stop` / `db:reset` / `db:status` — local Supabase stack in Docker (migrations + `supabase/seed.sql`, adjudicator served locally)
- `npm run test:7p` — seven-player end-to-end game against the local stack (`test:7p:live` for the cloud)
- `npm run live:push` (`-- --dry-run`) / `live:deploy-functions` — ship migrations / the adjudicator to the cloud project (the only way to reach it; see below)

## Local vs live backend

Develop and test against the **local** stack first; promote to **live** only once it works there. One switch, `BACKEND=local|live`, resolved by `scripts/backend.ts` and shared by `vite.config.ts` and the Node test scripts. `local` reads its URL/keys from `supabase status` (nothing to copy); `live` uses `.env`. Defaults: `vite` dev → local, `vite build` → live, `test:7p` → local. The dev-seat pill shows a LOCAL/LIVE badge.

- `supabase/config.toml` configures **only the local stack** (anonymous sign-ins on, dev adjudicator secret), and is structurally kept off the live project:
  - `node_modules/.bin/supabase` is `scripts/supabase-guard.mjs` (installed by `postinstall`, asserted by `supabaseGuard.test.ts`). It refuses `config push` and `--include-seed` always, and `link` / `--project-ref` unless called from `scripts/live.mjs`.
  - The checkout stays **unlinked**. `scripts/live.mjs` (behind `npm run live:*`) links, runs one allowlisted command, and unlinks in `finally`. Don't `supabase link` by hand; add a command to its allowlist instead.
- `supabase/seed.sql` wires the local cron to the local Edge Function (`private.engine_config`). It runs on `db:start`/`db:reset`, never on `db push`.
- Workflow for a backend change: `npm run db:reset` → `npm run test:7p` / `npm run dev` with dev seats → `npm run live:push` + `npm run live:deploy-functions`. The step-by-step versions are the **`local-test`** and **`push-live`** skills (`.claude/skills/`).

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
  - `migrations/` — timestamp-prefixed SQL migrations (`20250101000101_schema.sql`, …), applied in filename order. RLS policies and RPC functions live here. Apply with **`supabase db push`** (it runs any migration not yet in the remote's history); add new ones with `supabase migration new <name>`. Never hand-edit an applied migration — write a new one.
  - `functions/` — Edge Functions (Deno). Houses the single authoritative adjudicator, which imports the engine in `src/lib/adjudicator/`.

## Turn Engine & State Model

Turns execute on a timer (every X hours/days, per `settings.turn_timer`) inside Supabase — Postgres plus **one authoritative adjudicator Edge Function**, no custom server. Postgres holds the order log and schedules; the Edge Function is the only thing that resolves a round and advances the board.

- **Scheduler — `pg_cron` (pure SQL, never adjudicates).** A single Postgres cron job ticks frequently (every 1–5 min) and, for each active game that is due (all powers ready — before the deadline only with early resolution on — or its grace period has run out; see below), invokes the adjudicator Edge Function via `pg_net`. One job for all games, not one per game. Use `for update skip locked` so concurrent ticks are safe, and a partial index (`(deadline) where phase in ('movement','retreat','build')`) to keep the tick a no-op when nothing is due.
- **Adjudicator — Edge Function (Deno + TS), the single source of truth for resolution.** Runs with the service role. For a due round it: reads that round's orders, resolves them (supports, cuts, convoys, retreats, builds), marks the round `resolved`, advances the phase pointer, and **writes the board snapshot** — all committed through `apply_resolution`, which also stamps the next deadline via `phase_deadline` (`20250101000132_phase_deadline.sql`, the only deadline math; `start_game` and `apply_revert` use it too). Every call into the Edge Function goes through `fire_adjudicator`. It is the *only* writer of resolved state. The resolution logic itself is the pure engine in `src/lib/adjudicator/`, parameterized by a `MapDefinition` so it supports any variant. Test it with a TS port of the DATC suite; use `zond/godip` as a behavioral oracle for edge cases.
- **Trust — RLS + secrecy.** Players may write only their *own* orders for the current, unresolved round. Other nations' current-round orders are **unreadable until `resolved` is set** — the `resolved` flag is the simultaneous-reveal gate, and Realtime must not stream unresolved foreign orders. The Edge Function (service role) bypasses RLS and is the sole mutator of the board.
- **Push — Realtime.** Clients subscribe to game changes (see `subscribeToGame`) and receive the new snapshot + revealed orders on each resolution.

### State model — event-sourced log, authoritative snapshot

The append-only order log is the **source of truth**; the snapshot is the **authoritative cache** the Edge Function writes from it.

- Persist every round's orders in an append-only `orders` table keyed by `(game_id, year, season, phase, nation)`, each carrying a `resolved` flag set at adjudication. The full resolved log can always rebuild any board — history scrub, or a rebuild-after-adjudicator-bugfix is just re-running the Edge Function over the log and regenerating snapshots.
- On each resolution the Edge Function writes a **board snapshot** (units, ownership, dislodgements, build counts). **Clients read the snapshot for display — they do not replay the log and there is no client-side adjudicator.** This keeps egress low (a few KB per load vs. the whole log) and keeps a single, authoritative resolver. The order *wizard* still derives legal-move options client-side from the map graph (`src/lib/orders/`); that is entry-time legality, not adjudication.
- The snapshot is a cache derived from the log, **never** the source of truth: if the engine changes, replay the log to regenerate it.

### Resolution triggers: all ready, early or after a grace period

1. **Early — all powers ready.** Players submit/finalize orders, which sets a per-nation `ready` flag (the submit RPC enforces own-nation, current-round only). The submit that completes the set fires the adjudicator **immediately** from the RPC (`maybe_resolve_now`) rather than waiting for the next cron tick — gated on the per-game `settings.early_resolution` toggle (default on). With early resolution off, a game resolves only at its deadline even when every power is ready.
2. **Deadline → grace period.** A deadline that passes with powers still unready does **not** resolve the round at once. The phase enters a *grace period* (`settings.grace_period` minutes, a lobby option that hosts can also change mid-game; it defaults to one movement timer and 0 turns it off). It resolves the moment the last power submits (via `maybe_resolve_now`, whatever `early_resolution` is set to) or, failing that, when the grace period ends, and unready nations hold. The next deadline is stamped from the resolution time, so the schedule shifts. A trigger keeps `games.grace_ends_at` = `deadline` + `grace_minutes(settings)` (`20250101000133_grace_ends_at.sql`); `resolution_due` reads it, and the board shows who it's waiting on plus a countdown to it — the client never re-derives the grace length. A host can cut it short with `host_force_resolve`.

### Phase progression — the Edge Function skips no-op phases

Because the Edge Function adjudicated the round, it *knows* what comes next: it opens a **retreat** phase only if a unit was dislodged, and a **build** phase only if supply-center counts force adjustments. No-op phases are skipped outright (no wasted timer window). Each opened phase gets its own deadline.

### Orders: one row per round, draft vs. submitted decided by `ready`

A nation has a **single** `orders` row per `(game, year, season, phase)` holding its order set whether drafted or submitted — what makes it count is `games.ready[nation]`, not a separate table. There are exactly two client write paths to that row:

- **Drafting (not ready).** While the nation is not ready, the client autosaves edits via `save_draft_orders` — silent (the `orders` table is not in the realtime publication, so a draft is never broadcast) and never touching `ready`.
- **Submitting / resubmitting.** `submit_orders` overwrites the row and sets `ready = true`, which *is* broadcast (others see who has readied). The adjudicator honors a nation's orders only if it's ready; an unsubmitted draft is treated as a hold.

Once a nation is ready, `save_draft_orders` refuses to write (server-side guard), so an autosave can never clobber a submitted set. Post-submit edits live only in the client and persist solely on an explicit resubmit (which stays ready) — there is currently **no un-ready path**, so readiness clears only at resolution. Both RPCs stamp the round being edited and silently drop / reject a write that races a resolution, so a stale write can't land in the next round's row.

Resolved rounds are immutable (they form the replay log) — the one exception is a host **revert** (below). The adjudicator's `apply_resolution` is the only other writer: it blanks the orders of nations that weren't ready (so the log matches what was adjudicated) and flips `resolved = true`. Enforce all of this in RLS / the RPCs: client writes are allowed only for the current round's own nation, and rejected once `resolved` is set.

### Ending by agreement: ties and concessions

Each surviving power holds one **secret** vote in `draw_votes` (`20250101000141_draw_votes.sql`): solo (the default, no row), a tie with a set of powers, or concede. The game ends when some set of survivors all vote for exactly that set and every other survivor concedes (eliminated powers count as conceding); a set of one is a win by concession. Votes are readable only by their owner until the game is `complete` (RLS; not in the realtime publication), so players can bluff about their vote. `settle_draw` ends the game — it moves no units, only stamps `phase = 'complete'` and `games.result` — and runs from `set_draw_vote` and after every `apply_resolution`, never while a resolution is in flight. A host revert clears the votes and the result.

### Host controls (private games, opt-in in the lobby)

`settings.host_controls` is set in the lobby, is fixed once the game starts, and requires (and locks) `is_private` — enforced by a trigger (`20250101000129_host_controls.sql`). Only then does the creator get the in-game admin menu: deadline override, pacing settings, **force-resolve** (`host_force_resolve` — fires the adjudicator now, unready nations hold) and **revert** (`host_revert_to` — the Edge Function replays the log to the target round and commits via `apply_revert`, deleting later rounds and reopening that round's orders as drafts). Both go through the Edge Function, so it stays the sole board writer.

### Free-tier shape (Supabase)

The design is sized to fit Supabase's free tier for ~100 games/month. Two constraints shape the schema:

- **Egress (5 GB):** clients read the small snapshot + Realtime deltas, never the full log — this is why the snapshot exists.
- **Database (500 MB):** the order log grows ~40 MB/month and never shrinks. **Archive completed games** (dump the log to File Storage, delete the rows) so storage stays flat.
- Edge Function invocations (~1 per resolution, ~10k/month) are a rounding error against the 500k free quota. Note free projects pause after ~1 week of inactivity, which stops `pg_cron`.

## Conventions

- Supabase env vars are injected at build time via Vite (`import.meta.env.VITE_*`); production secrets come from GitHub Actions secrets.
- Board-advancing logic lives only in the adjudicator Edge Function (service role); player writes go through RLS-guarded, own-nation order submissions. Never trust the client to mutate game state.
- Functions in `public` are **not executable by default** (`20250101000128_lock_down_rpcs.sql`). A new client-facing RPC needs an explicit `grant execute … to authenticated` in its migration; internal/service-only functions get no grant.
- Diplomacy province notation: **seas in ALL CAPS**, **land in Title Case**, **coasts as `Stp(sc)`**.

## References

- **[johnpooch/diplicity-react](https://github.com/johnpooch/diplicity-react)** — a React Diplomacy client to study for UI/UX patterns (order entry wizard, board interaction, game lifecycle). Good reference for how an online Diplomacy front-end is structured; adapt ideas to our Svelte + Supabase stack rather than copying.
