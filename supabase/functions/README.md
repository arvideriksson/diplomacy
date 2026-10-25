# Supabase functions

## `adjudicate`

The single authoritative turn resolver. Invoked by `pg_cron` (see the cron
migration in `supabase/migrations/`) via `pg_net` with a service-role bearer token and a
`{ "game_id": "..." }` body. It loads the game, runs the **pure engine** in
`src/lib/adjudicator`, and atomically commits the result via the
`apply_resolution` RPC. It is the only writer of resolved state.

### Apply order (run migrations first)

1. `008_turn_engine_schema.sql` … `012_cron.sql` in the SQL editor (in order).
2. Enable the `pg_cron` and `pg_net` extensions (Database → Extensions).
3. **Bundle the engine, then deploy:**
   ```sh
   npm run live:deploy-functions      # build:edge, then supabase functions deploy adjudicate
   ```
4. Insert the engine config (out of band — never commit the key):
   ```sql
   insert into private.engine_config (function_url, service_key)
   values ('https://<ref>.supabase.co/functions/v1/adjudicate', '<service-role-key>');
   ```
   Prefer Supabase Vault for the key if available.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the Edge runtime
automatically; the function verifies the incoming bearer token against the latter.

### How the engine reaches the function (the import boundary)

The function does **not** import the engine across the `src ↔ functions` boundary
directly — Supabase's Deno bundler can't reach outside `supabase/functions/`, and
the engine uses extensionless imports Deno won't resolve. Instead, `npm run
build:edge` esbuild-bundles `src/lib/adjudicator/edge-entry.ts` into a single
self-contained `adjudicate/_engine.mjs` (all relative imports + extensions
resolved), which `resolve.ts` imports locally. `db.ts` pulls the Supabase client
via an `npm:` specifier, so **no import map / `deno.json` is needed**.

`_engine.mjs` is a generated artifact — **rerun `npm run build:edge` after any
change to the engine** (and before deploying). It is committed so a fresh checkout
can deploy without a build, but it must stay in sync with `src/lib/adjudicator/`.

### Local development

`npm run db:start` (Docker) bundles the engine and starts the local stack, which serves
this function with `ADJUDICATOR_SECRET` from `[edge_runtime.secrets]` in
`supabase/config.toml`; `supabase/seed.sql` points `private.engine_config` at it
(`http://kong:8000/…`, the gateway's address inside Docker). So the local cron and
`maybe_resolve_now` drive real resolutions — `npm run test:7p` exercises the whole loop.
After an engine change, `npm run db:reset` (rebuilds `_engine.mjs`, reapplies migrations +
seed); the function hot-reloads on edits to its own files.

Engine correctness is covered by `npm test` (the DATC suite) — run that, not the
function, to validate rules changes.
