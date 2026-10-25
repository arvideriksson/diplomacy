-- First turn: an opening movement phase with its own length.
--
-- settings.first_turn (minutes) sets the deadline of the game's first phase, which
-- usually wants extra time for the opening negotiations. Absent, null or 0 = the
-- movement timer, as before. Only start_game reads it; every later deadline
-- (apply_resolution, apply_revert) still comes from phase_deadline.

create or replace function public.first_turn_deadline(p_settings jsonb, p_from timestamptz)
returns timestamptz as $$
  select coalesce(
    p_from + make_interval(mins => nullif(greatest(0, (p_settings ->> 'first_turn')::int), 0)),
    public.phase_deadline(p_settings, 'movement', p_from));
$$ language sql stable;  -- timestamptz + interval depends on the session time zone

-- ── start_game (re-issues 138; only the deadline line changes) ─────────────────
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
  g := public.lock_owned_game(p_game_id, 'Only the game creator can start the game');
  if g.phase <> 'lobby' then raise exception 'Game has already started'; end if;

  select m.powers, m.starting_year into powers, start_year
    from public.maps m where m.id = g.map_id;
  if powers is null then raise exception 'Unknown map: %', g.map_id; end if;

  if (select count(*) from jsonb_object_keys(g.players)) > array_length(powers, 1) then
    raise exception 'Too many players for this map (max %)', array_length(powers, 1);
  end if;

  random_mode := public.setting_bool(g.settings, 'random_nations', false);

  -- Powers nobody validly claimed, shuffled.
  select coalesce(array_agg(pw order by random()), '{}') into free
    from unnest(powers) pw
   where random_mode
      or not (pw = any(coalesce(public.game_nations(g.players), '{}')));

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
         deadline     = public.first_turn_deadline(g.settings, now()),
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;
