---
name: push-live
description: Ship backend changes to the live Supabase project — apply new migrations (schema, RLS, RPCs) and deploy the adjudicator Edge Function. Use when asked to push, deploy, release or "go live" with database/function changes. Requires the local-test skill to have passed first.
---

# Push to live

The live project is real players' games. Every step here is outward-facing: **show the
user what will change and get an explicit yes before each live command.** Approval for
one push does not cover the next.

The only path to live is `scripts/live.mjs` (behind `npm run live:*`): it links the
project from `.env`, runs one allowlisted command, and unlinks. The checkout is otherwise
unlinked and `node_modules/.bin/supabase` is a guard (`scripts/supabase-guard.mjs`) that
refuses `config push`, `--include-seed`, `link` and `--project-ref`. Don't work around it
(no `supabase link`, no `DIPLOMACY_LIVE_SCRIPT=1`, no global CLI, no SQL pasted into the
dashboard). If a needed live command isn't allowlisted, add it to `COMMANDS` in
`scripts/live.mjs` in a reviewed change.

Frontend changes don't go through here — the site deploys from `main` via GitHub Actions.

## 1. Preconditions

- The `local-test` skill passed for this change: `npm run db:reset`, `npm test`,
  `npm run check`, `npm run test:7p` — all green, against **local**.
- `supabase/current-functions.sql` regenerated (`npm run sql:current`) and
  `supabase/functions/adjudicate/_engine.mjs` rebuilt (`npm run build:edge`) — CI fails on either being stale.
- The change is committed (live must match a commit, not a dirty tree). Ask before committing.
- No already-applied migration was edited: `git diff <last live commit> -- supabase/migrations`
  should only add files. Editing an applied migration does nothing on live (it's skipped by
  name) and silently forks local from live.

## 2. Preview the migrations

```sh
npm run live:push -- --dry-run
```

Show the user the list of pending migrations it prints. If it lists files you didn't expect
(e.g. old ones), stop — live history and the repo disagree; investigate before pushing.

Review each pending migration for live-data safety, since local tests ran on an empty db:
- Destructive changes (`drop column/table`, type narrowing, `not null` without a default,
  new `check`/unique constraints) — will existing rows violate or lose data?
- Long locks on `games` / `orders` while games are running.
- New RPCs have their `grant execute … to authenticated` (and internal ones don't).
- Function signature changes vs. what the **currently deployed** frontend calls (the
  site redeploys separately; old clients may be open).

## 3. Order of operations

Pick the order so that live is consistent at every moment:

1. **Migrations first** when the new Edge Function or frontend needs new tables/columns/RPCs
   (the usual case — make migrations additive).
2. **Function first** when a migration removes something the old function still uses;
   ship it as two steps (deploy compatible function → later drop the old thing).
3. **Frontend** (merge to `main`) last, once the backend it calls is live.

## 4. Push

With the user's go-ahead:

```sh
npm run live:push                    # applies pending migrations, then unlinks
npm run live:deploy-functions        # only if supabase/functions/ or src/lib/adjudicator/ changed
```

If the CLI prompts for the database password or a login (`supabase login`), it can't be
answered from here — ask the user to run the same command themselves as
`! npm run live:push`.

`live:push` never sends `supabase/seed.sql` or `config.toml`: live settings (auth providers,
redirect URLs, `ADJUDICATOR_SECRET` via `supabase secrets set`, `private.engine_config`) are
managed in the dashboard and are not part of this flow. If a change needs one of those
updated, tell the user exactly what to set — don't attempt it.

## 5. Verify

- Re-run `npm run live:push -- --dry-run`: it should report nothing pending.
- `npm run test:7p:live` is a real end-to-end check but **creates a public game with seven
  anonymous players on live** — only with the user's OK, and mention the game id it prints
  so they can delete it.
- Otherwise ask the user to load a live game and confirm it renders and accepts orders.

## 6. If it went wrong

Migrations are forward-only — don't edit or delete the applied file. Write a new corrective
migration, run it through `local-test`, then push again. A broken function can be
redeployed from the previous commit (`git checkout <good> -- supabase/functions && npm run live:deploy-functions`, with the user's OK).
Report exactly what was applied (migration file names, function deployed) and when.
