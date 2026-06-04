-- Append-only order log: one row per (game, round, nation), holding that nation's
-- full order set for the round as a jsonb array. The reveal gate is per-nation-
-- per-round, so one row makes the secrecy policy a single-row predicate and the
-- simultaneous reveal a single `update ... set resolved = true`.

create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  year         integer not null,
  season       text    not null check (season in ('Spring', 'Fall')),
  phase        text    not null check (phase in ('movement', 'retreat', 'build')),
  nation       text    not null,
  orders       jsonb   not null default '[]',   -- array of engine-shaped order objects
  resolved     boolean not null default false,  -- simultaneous-reveal gate
  submitted_by uuid references auth.users(id),  -- audit only, never authority
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (game_id, year, season, phase, nation)
);

alter table public.orders enable row level security;

-- Hot path: "all orders for this game's current round".
create index if not exists orders_round_idx
  on public.orders (game_id, year, season, phase);

-- Resolved-log scan for archival / replay.
create index if not exists orders_game_resolved_idx
  on public.orders (game_id, resolved);

create or replace trigger orders_updated_at
  before update on public.orders
  for each row execute function public.update_updated_at();

-- NOTE: public.orders is intentionally NOT added to the supabase_realtime
-- publication. Clients subscribe to `games` and one-shot read the now-resolved
-- orders after a resolution — this removes the unresolved-order leak surface
-- entirely and keeps egress low.
