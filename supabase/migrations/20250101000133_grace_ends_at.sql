-- Store when a phase's grace period ends, so the client stops re-deriving it.
--
-- 130_grace_period.sql derived the grace end in SQL (resolution_due via
-- grace_minutes) while the client mirrored grace_minutes as graceMinutes() in
-- src/lib/game.ts for its countdown. games.grace_ends_at is now kept by a trigger
-- from deadline + grace_minutes(settings); resolution_due reads it and the client
-- shows it, so grace_minutes() is the only definition of the grace length.
--
-- A trigger rather than a generated column: Realtime must broadcast the value, and
-- logical replication does not publish generated columns.

alter table public.games add column if not exists grace_ends_at timestamptz;

create or replace function public.set_grace_ends_at()
returns trigger as $$
begin
  new.grace_ends_at := new.deadline + make_interval(mins => public.grace_minutes(new.settings));
  return new;
end;
-- Definer: client inserts/updates fire this, and grace_minutes() isn't granted to them.
$$ language plpgsql security definer;

drop trigger if exists games_grace_ends_at on public.games;
create trigger games_grace_ends_at
  before insert or update on public.games
  for each row
  execute function public.set_grace_ends_at();

-- Backfill running games (the trigger computes the value) without bumping updated_at.
alter table public.games disable trigger games_updated_at;
update public.games set grace_ends_at = null where deadline is not null;
alter table public.games enable trigger games_updated_at;

-- ── resolution_due (re-issues 130) ─────────────────────────────────────────────
create or replace function public.resolution_due(g public.games)
returns boolean as $$
  select g.grace_ends_at <= now()
      or (public.all_powers_ready(g.id)
          and (   coalesce((g.settings ->> 'early_resolution')::boolean, true)
               or (g.deadline is not null and g.deadline <= now())));
$$ language sql stable security definer;
