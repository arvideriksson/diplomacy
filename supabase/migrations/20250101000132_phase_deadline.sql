-- One owner for deadline math: phase_deadline().
--
-- The first deadline was computed in SQL (start_game, 128) and every later one in
-- the Edge Function (deadlineFor in functions/adjudicate/resolve.ts), which also kept
-- a legacy turn_timer table made dead by the 121 backfill — with defaults that
-- disagreed with DEFAULT_SETTINGS. Now start_game, apply_resolution and apply_revert
-- all stamp the deadline here from the game's own settings and the DB clock, and the
-- Edge Function no longer passes p_deadline.
--
-- Deploy together with the Edge Function (`supabase functions deploy adjudicate`):
-- the old function still sends p_deadline, which the new signatures reject. A
-- resolution that fails in between is released and retried by the next cron tick.

-- Minutes a phase lasts: settings.phase_timers[phase] when positive, else the
-- DEFAULT_SETTINGS value (movement 24h, retreat/build 12h).
create or replace function public.phase_timer_minutes(p_settings jsonb, p_phase text)
returns integer as $$
  select coalesce(
    nullif(greatest(0, (p_settings -> 'phase_timers' ->> p_phase)::int), 0),
    case p_phase when 'movement' then 1440 else 720 end);
$$ language sql immutable;

create or replace function public.phase_deadline(p_settings jsonb, p_phase text, p_from timestamptz)
returns timestamptz as $$
  select p_from + make_interval(mins => public.phase_timer_minutes(p_settings, p_phase));
$$ language sql stable;  -- timestamptz + interval depends on the session time zone

-- ── apply_resolution (re-issues 122 without p_deadline) ─────────────────────────
drop function public.apply_resolution(uuid, jsonb, jsonb, jsonb, timestamptz, jsonb);

create function public.apply_resolution(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } just resolved
  p_snapshot   jsonb,
  p_next       jsonb,        -- { phase, season, year } to advance to
  p_ready_init jsonb default '{}'  -- nations auto-readied for the opening phase
)
returns void as $$
begin
  -- Unready nations held: blank their orders so the log matches the adjudication.
  update public.orders o
     set orders = '[]'::jsonb, updated_at = now()
    from public.games g
   where g.id = p_game_id
     and o.game_id = p_game_id
     and o.year   = (p_round->>'year')::int
     and o.season =  p_round->>'season'
     and o.phase  =  p_round->>'phase'
     and o.resolved = false
     and not coalesce((g.ready ->> o.nation)::boolean, false);

  update public.orders
     set resolved = true, updated_at = now()
   where game_id = p_game_id
     and year   = (p_round->>'year')::int
     and season =  p_round->>'season'
     and phase  =  p_round->>'phase'
     and resolved = false;

  update public.games
     set snapshot     = p_snapshot,
         phase        = p_next->>'phase',
         season       = p_next->>'season',
         year         = (p_next->>'year')::int,
         deadline     = case when p_next->>'phase' = 'complete' then null
                             else public.phase_deadline(settings, p_next->>'phase', now()) end,
         ready        = coalesce(p_ready_init, '{}'::jsonb),
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

grant execute on function public.apply_resolution(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ── apply_revert (re-issues 129 without p_deadline) ─────────────────────────────
drop function public.apply_revert(uuid, jsonb, jsonb, timestamptz, jsonb);

create function public.apply_revert(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } to reopen
  p_snapshot   jsonb,        -- the board going into that round
  p_ready_init jsonb default '{}'
)
returns void as $$
declare
  target integer := public.round_rank(
    (p_round ->> 'year')::int, p_round ->> 'season', p_round ->> 'phase');
begin
  delete from public.orders
   where game_id = p_game_id
     and public.round_rank(year, season, phase) > target;

  update public.orders
     set resolved = false, updated_at = now()
   where game_id = p_game_id
     and public.round_rank(year, season, phase) = target;

  update public.games
     set snapshot     = p_snapshot,
         phase        = p_round ->> 'phase',
         season       = p_round ->> 'season',
         year         = (p_round ->> 'year')::int,
         deadline     = public.phase_deadline(settings, p_round ->> 'phase', now()),
         ready        = coalesce(p_ready_init, '{}'::jsonb),
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

grant execute on function public.apply_revert(uuid, jsonb, jsonb, jsonb) to service_role;

-- ── start_game (re-issues 128; only the deadline line changes) ──────────────────
create or replace function public.start_game(p_game_id uuid)
returns void as $$
declare
  g           public.games;
  powers      text[];
  start_year  integer;
  random_mode boolean;
  free        text[];
  next_free   integer := 1;
  p           record;
  assigned    jsonb;
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null then raise exception 'Game not found'; end if;
  if g.created_by <> auth.uid() then
    raise exception 'Only the game creator can start the game';
  end if;
  if g.phase <> 'lobby' then raise exception 'Game has already started'; end if;

  powers := case g.map_id
    when 'classical' then array['england', 'france', 'germany', 'italy', 'austria', 'russia', 'turkey']
    when '1900'      then array['britain', 'france', 'germany', 'italy', 'austria', 'russia', 'turkey']
  end;
  start_year := case g.map_id when '1900' then 1900 else 1901 end;
  if powers is null then raise exception 'Unknown map: %', g.map_id; end if;

  if (select count(*) from jsonb_object_keys(g.players)) > array_length(powers, 1) then
    raise exception 'Too many players for this map (max %)', array_length(powers, 1);
  end if;

  random_mode := coalesce((g.settings ->> 'random_nations')::boolean, false);

  -- Powers nobody validly claimed, shuffled.
  select coalesce(array_agg(pw order by random()), '{}') into free
    from unnest(powers) pw
   where random_mode
      or not exists (
           select 1 from jsonb_each(g.players) e where e.value ->> 'nation' = pw);

  assigned := g.players;
  for p in select key as uid, value ->> 'nation' as claimed from jsonb_each(g.players) loop
    if random_mode or p.claimed is null or not (p.claimed = any(powers)) then
      assigned := jsonb_set(assigned, array[p.uid, 'nation'], to_jsonb(free[next_free]));
      next_free := next_free + 1;
    end if;
  end loop;

  update public.games
     set phase        = 'movement',
         year         = start_year,
         season       = 'Spring',
         players      = assigned,
         snapshot     = null,
         ready        = '{}'::jsonb,
         resolving_at = null,
         deadline     = public.phase_deadline(g.settings, 'movement', now()),
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;
