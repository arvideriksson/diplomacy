-- Turn-engine columns on games. Run in the Supabase SQL Editor (after 001-007).
--
-- The board SNAPSHOT is the authoritative cache the adjudicator Edge Function
-- writes each resolution; clients read it instead of replaying the order log.
-- `ready` is per-nation early-resolution flags; `resolving_at` is the in-flight
-- lock that makes resolution exactly-once under concurrent cron ticks.

alter table public.games
  add column if not exists deadline     timestamptz,
  add column if not exists snapshot     jsonb,
  add column if not exists ready        jsonb not null default '{}',
  add column if not exists resolving_at timestamptz;

-- Migrate the old 'active' phase to the movement phase before constraining the set.
update public.games set phase = 'movement' where phase = 'active';

alter table public.games drop constraint if exists games_phase_chk;
alter table public.games
  add constraint games_phase_chk
  check (phase in ('lobby', 'movement', 'retreat', 'build', 'resolved', 'complete'));
