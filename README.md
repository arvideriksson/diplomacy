# Diplomacy

A web app for playing the board game Diplomacy online, built with Svelte 5, Vite and TypeScript on a Supabase backend.

## Setup

Requires Docker (or Podman) for the local Supabase stack; the Supabase CLI comes with `npm install`.

```sh
npm install
npm run db:start   # local Supabase: Postgres, Auth, Realtime, Edge Functions (applies migrations + seed)
npm run dev        # Vite dev server against the local stack
```

To work against the cloud project instead, create `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and run `npm run dev:live`.

## Commands

- `npm run dev` / `npm run dev:live` — dev server against the local stack / the cloud project
- `npm run db:start` / `db:stop` / `db:reset` — manage the local Supabase stack
- `npm run test:7p` / `test:7p:live` — seven-player end-to-end smoke game
- `npm run build` — production build
- `npm run check` — type-check
- `npm test` — run tests
