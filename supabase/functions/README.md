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
   npm run build:edge                 # esbuild → adjudicate/_engine.mjs
   supabase functions deploy adjudicate
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

Requires the `deno` and `supabase` CLIs (not installed in CI by default):

```sh
supabase start
npm run build:edge                       # regenerate _engine.mjs first
# apply 008–012 against the local db, then:
supabase functions serve adjudicate --no-verify-jwt
# POST { "game_id": "<uuid>" } with the local service key to drive a resolution
```

Engine correctness is covered by `npm test` (the DATC suite) — run that, not the
function, to validate rules changes.
