-- An eliminated power (no unit, no supply center) never blocks a round.
--
-- Readiness counted every seated nation, and only the adjudicator's idle auto-ready kept
-- an eliminated one from blocking — but idleNations() looks only at nations present on
-- the board, so a power with nothing left was never readied: the round sat in its grace
-- period "waiting" on it, and it was pushed round reminders.
--
-- Readiness now counts survivors only (surviving_nations: everyone before the first
-- resolution, then nations with a unit or a center), the same rule draw votes use.
-- unready_nations is the single source; all_powers_ready reads it.

create or replace function public.unready_nations(g public.games)
returns text[] as $$
  select coalesce(array_agg(n), '{}')
    from unnest(public.game_nations(g.players)) n
   where n = any(public.surviving_nations(g))
     and not public.is_ready(g.ready, n);
$$ language sql stable;

create or replace function public.all_powers_ready(p_game_id uuid)
returns boolean
language plpgsql security definer stable
set search_path = public, extensions, pg_temp
as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id;
  if g is null or public.game_nations(g.players) is null then return false; end if;
  return cardinality(public.unready_nations(g)) = 0;
end;
$$;
