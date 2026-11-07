# Supabase functions

Two Edge Functions, both reached only from Postgres via `pg_net` with
`Authorization: Bearer <ADJUDICATOR_SECRET>` (a dedicated shared secret; `verify_jwt` is
off). Postgres holds the URL and secret in `private.engine_config` (`function_url`, and
`service_key` — which, despite its name, holds `ADJUDICATOR_SECRET`, not the service-role
key). `_shared/edge.ts` has the secret gate and the service-role client both use.

## `adjudicate`

The single authoritative turn resolver and the only writer of resolved state. Every call
goes through `public.fire_adjudicator`, which claims the game (`games.resolving_at`) and
posts:

- `{ game_id }` — resolve the current round (from `tick_due_games`, `maybe_resolve_now`
  or `host_force_resolve`). It loads the game, runs the **pure engine** in
  `src/lib/adjudicator`, and commits through `apply_resolution`, passing the claim it read
  (`p_claim`) and the nations whose orders it honoured (`p_honoured`); the commit refuses
  to land over a claim that was reaped and re-fired.
- `{ game_id, action: 'revert', target }` — replay the resolved log to an earlier round
  and commit it through `apply_revert` (from `host_revert_to`).

A failure releases the claim (500), so the next cron tick retries.

## `notify`

Web Push sender. SQL (`public.push_notify`) picks the recipients and builds the payload;
this function only looks up their `push_subscriptions`, sends, and drops the ones the push
service reports gone. Its URL is the adjudicator's with the last segment swapped to
`notify`. Needs the `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` secrets.

## Deploying (live)

Migrations first (`npm run live:push`), then `npm run live:deploy-functions` (runs
`build:edge`, then deploys both functions). Secrets: `npm run live:secrets` (from the
gitignored `.env.functions.local`) and `npm run live:rotate-adjudicator-secret`. See the
`push-live` skill.

## How the engine reaches the function (the import boundary)

The function does **not** import the engine across the `src ↔ functions` boundary —
Supabase's Deno bundler can't reach outside `supabase/functions/`, and the engine uses
extensionless imports Deno won't resolve. Instead `npm run build:edge` esbuild-bundles
`src/lib/adjudicator/edge-entry.ts` (the engine, the map definitions and the phase list)
into a single self-contained `adjudicate/_engine.mjs`, which `resolve.ts` imports.

`_engine.mjs` is generated and committed; CI fails when it is stale. **Rerun
`npm run build:edge` after any change to `src/lib/adjudicator/`, `src/lib/maps/` or
`src/lib/phases.ts`.**

## Local development

`npm run db:start` bundles the engine and starts the local stack, which serves both
functions with the dev secrets from `[edge_runtime.secrets]` in `supabase/config.toml`;
`supabase/seed.sql` points `private.engine_config` at `http://kong:8000/…`. So the local
cron and `maybe_resolve_now` drive real resolutions — `npm run test:7p` exercises the
whole loop. After an engine change run `npm run build:edge` (the function hot-reloads its
own files) or `npm run db:reset`.

Engine correctness is covered by `npm test` (the DATC suite).
