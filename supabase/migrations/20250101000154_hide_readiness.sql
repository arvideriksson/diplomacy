-- Who has readied is secret until the grace period. A player learns only their own
-- flag, and — once the deadline has passed and the phase is waiting — which powers it
-- is waiting on. Before this, games.ready was readable by every player (and spectator)
-- in the game row, every ready toggle was broadcast as a {ready} patch, and each toggle
-- bumped games.updated_at, so even the timing gave it away.
--
-- 1. Column privileges: players read every games column except `ready`. The engine
--    (service role) and the SECURITY DEFINER functions (submit_orders, resolution_due,
--    apply_resolution, push reminders, …) keep reading it as before.
--    NOTE: a column added to games later must be added to this grant to be readable.
-- 2. game_readiness(game): the caller's own flag, plus `waiting` during a grace period.
--    my_ready(game): the caller's own flag alone (for list_games, which runs as the
--    caller and so can no longer read the column).
-- 3. updated_at no longer moves when only ready / resolving_at change.
-- 4. The broadcast trigger never sends `ready`; during a grace period a ready toggle
--    sends the new `waiting` list instead.

-- ── 1. column privileges ─────────────────────────────────────────────────────────
revoke select on public.games from anon, authenticated;
grant select (
  id, name, phase, year, season, players, created_by, created_at, updated_at,
  is_private, settings, map_id, deadline, snapshot, resolving_at, grace_ends_at, result
) on public.games to anon, authenticated;

-- ── 2. readiness reads ───────────────────────────────────────────────────────────
-- In a grace period: an order phase whose deadline has passed (and hasn't resolved).
create or replace function public.in_grace(g public.games)
returns boolean as $$
  select g.phase in ('movement', 'retreat', 'build')
     and g.deadline is not null
     and g.deadline <= now();
$$ language sql stable;

-- The caller's own ready flag in a game, or null if they hold no power there.
create or replace function public.my_ready(p_game_id uuid)
returns boolean as $$
  select case when g.players -> (auth.uid()::text) ? 'nation'
              then public.is_ready(g.ready, g.players -> (auth.uid()::text) ->> 'nation') end
    from public.games g
   where g.id = p_game_id;
$$ language sql stable security definer;

-- {nation, ready, waiting} for a game the caller can see (same rule as the games
-- select policy), else null. `waiting` is null outside a grace period.
create or replace function public.game_readiness(p_game_id uuid)
returns jsonb as $$
declare
  g public.games;
  me text;
begin
  select * into g from public.games
   where id = p_game_id
     and (not is_private or created_by = auth.uid() or players ? (auth.uid()::text));
  if not found then return null; end if;
  me := g.players -> (auth.uid()::text) ->> 'nation';
  return jsonb_build_object(
    'nation', me,
    'ready', case when me is not null then public.is_ready(g.ready, me) end,
    'waiting', case when public.in_grace(g) then to_jsonb(public.unready_nations(g)) end
  );
end;
$$ language plpgsql stable security definer;

grant execute on function public.game_readiness(uuid) to authenticated;
grant execute on function public.my_ready(uuid) to authenticated;

-- list_games (153) read g.ready directly; it runs as the caller, so it now asks
-- my_ready for the caller's own flag.
create or replace function public.list_games()
returns table (
  id uuid, name text, phase text, year integer, season text, map_id text,
  is_private boolean, created_by uuid, updated_at timestamptz, deadline timestamptz,
  ready jsonb, player_count integer, me jsonb,
  result jsonb, final_centers jsonb
)
language sql stable security invoker as $$
  select g.id, g.name, g.phase, g.year, g.season, g.map_id,
         g.is_private, g.created_by, g.updated_at, g.deadline,
         case when g.players -> (auth.uid()::text) ? 'nation'
              then jsonb_build_object(g.players -> (auth.uid()::text) ->> 'nation',
                                      coalesce(public.my_ready(g.id), false))
              else '{}'::jsonb end,
         (select count(*)::int from jsonb_object_keys(g.players)), g.players -> (auth.uid()::text),
         g.result,
         case when g.phase = 'complete' then g.snapshot -> 'supplyCenters' end
    from public.games g
   where g.phase <> 'complete' or g.players ? (auth.uid()::text) or g.created_by = auth.uid()
   order by g.updated_at desc;
$$;

-- ── 3. updated_at ignores readiness ──────────────────────────────────────────────
create or replace function public.touch_game_updated_at()
returns trigger as $$
declare
  quiet constant text[] := array['ready', 'resolving_at', 'updated_at'];
begin
  if (to_jsonb(new) - quiet) is distinct from (to_jsonb(old) - quiet) then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists games_updated_at on public.games;
create trigger games_updated_at
  before update on public.games
  for each row execute function public.touch_game_updated_at();

-- ── 4. broadcasts carry no readiness ─────────────────────────────────────────────
create or replace function public.broadcast_game_change()
returns trigger as $$
declare
  -- Columns whose change alone doesn't warrant re-sending the row.
  quiet constant text[] := array['ready', 'resolving_at', 'updated_at'];
begin
  if (to_jsonb(new) - quiet) is distinct from (to_jsonb(old) - quiet) then
    perform realtime.send(to_jsonb(new) - 'ready', 'game', 'game:' || new.id::text, true);
  elsif new.ready is distinct from old.ready and public.in_grace(new) then
    perform realtime.send(jsonb_build_object('waiting', to_jsonb(public.unready_nations(new))),
                          'waiting', 'game:' || new.id::text, true);
  end if;
  return null;
end;
$$ language plpgsql security definer;
