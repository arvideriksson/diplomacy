---
name: local-test
description: Test backend changes (migrations, RPCs, RLS, the adjudicator Edge Function, cron/resolution) against the local Supabase stack before they go live. Use whenever a change touches supabase/ or src/lib/adjudicator/, when asked to "test locally", or before running the push-live skill.
---

# Local test (Supabase in Podman/Docker)

Everything here hits the **local** stack only: `npm run dev`, `npm run test:7p` and the
`db:*` scripts default to it via `scripts/backend.ts`. Nothing in this skill can reach the
live project — that's the `push-live` skill.

## 0. Container runtime

The Supabase CLI talks to the Docker API. With Podman (rootless) that means:

```sh
systemctl --user is-active podman.socket || systemctl --user enable --now podman.socket
echo $DOCKER_HOST   # expect unix:///run/user/1000/podman/podman.sock
```

If `DOCKER_HOST` is empty, export it for the command (`DOCKER_HOST=unix:///run/user/1000/podman/podman.sock npm run db:start`)
and tell the user to set it permanently (`set -Ux DOCKER_HOST …` in fish). Below, `podman`
can be swapped for `docker`.

## 1. Bring the stack up to the current code

```sh
npm run db:status || npm run db:start   # first start applies all migrations + seed.sql
npm run db:reset                        # after ANY migration/seed/engine change: rebuild _engine.mjs, wipe, reapply
```

`db:reset` is the real test of a migration: it replays every file in
`supabase/migrations/` from scratch, in filename order, exactly as a fresh project would.
A migration that fails here will fail on live. Local data is disposable — reset freely.

New migration: `npx supabase migration new <name>` (timestamp-prefixed). Never edit a
migration that is already live — write a new one. New client-facing RPCs need
`grant execute … to authenticated` (see `20250101000128_lock_down_rpcs.sql`).

## 2. Static checks (no stack needed)

```sh
npm run check
npm test                       # DATC suite, map/SQL seed drift, supabase guard, …
npm run sql:current            # regenerate supabase/current-functions.sql (CI runs --check)
npm run build:edge && git diff --stat supabase/functions/adjudicate/_engine.mjs   # bundle must be committed in sync
```

## 3. End-to-end game

```sh
npm run test:7p
```

Seven anonymous players create → join → start → submit holds → ready. Readying the last
power fires `maybe_resolve_now` → `fire_adjudicator` → the locally served Edge Function →
`apply_resolution`. Success ends with `✓ resolved → Fall 1901` and
`✅ Full seven-player lifecycle works end to end.` The output starts with
`Backend: local (http://127.0.0.1:54321)` — if it says `live`, stop.

## 4. In the browser (UI + dev seats)

```sh
npm run dev      # refuses to start if the local stack is down
```

The dev-seat pill (bottom-left, 🧪) must show a green **LOCAL** badge. Use "Continue as
guest" (Google OAuth isn't configured locally), then the seat panel: fill a lobby,
switch seats (Alt+1…7), "Ready all other seats". Use the `run-app` skill for screenshots.
Studio (tables, SQL editor, auth users): http://127.0.0.1:54323.

## 5. Inspecting / debugging

SQL without a local psql:

```sh
podman exec -i supabase_db_diplomacy psql -U postgres -c "select id, phase, season, year, resolving_at from public.games order by created_at desc limit 5"
```

Useful queries:
- Cron ticks: `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5`
- Calls to the adjudicator: `select id, status_code, content, error_msg, created from net._http_response order by created desc limit 5`
  (403 → `ADJUDICATOR_SECRET` in config.toml and `private.engine_config` disagree; connection
  error → engine_config URL, should be `http://kong:8000/functions/v1/adjudicate`)
- Engine config: `select function_url from private.engine_config`

Edge Function logs: `podman logs --tail 100 supabase_edge_runtime_diplomacy`.
After editing `src/lib/adjudicator/`, run `npm run build:edge` (the function hot-reloads
its own files; the engine only changes through the bundle).

Test a revert / force-resolve the same way the app does: as the host seat in the browser,
or via the RPCs (`host_force_resolve`, `host_revert_to`) from a script using the local anon key.

## 6. Report

Say which of steps 1–4 ran and their result (paste failures verbatim). A backend change is
ready for `push-live` only when `db:reset`, `npm test`, `npm run check` and `test:7p` all pass
locally.

`npm run db:stop` when done (data persists across stop/start; `db:reset` wipes it).
