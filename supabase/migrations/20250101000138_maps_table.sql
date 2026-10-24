-- Map data in one table instead of hard-coded CASEs.
--
-- start_game (128/132) hard-coded each map's power list and start year, and
-- join_public_game (104) hard-coded a 7-player cap. public.maps now holds both, keyed by
-- games.map_id. The seed mirrors src/lib/maps/* (power ids in order; startingYear,
-- default 1901) and src/lib/maps/sqlSeed.test.ts fails if they drift — a new map needs
-- a migration inserting its row.
--
-- No client access: RLS is on with no policies and the table grants are revoked. The
-- client already has the full MapDefinition; this table exists only for the
-- security-definer RPCs, so exposing it would add surface and nothing else.

create table if not exists public.maps (
  id            text    primary key,
  powers        text[]  not null check (cardinality(powers) > 0),
  starting_year integer not null default 1901
);

alter table public.maps enable row level security;
revoke all on public.maps from anon, authenticated;

insert into public.maps (id, powers, starting_year) values
  ('classical', array['england', 'france', 'germany', 'italy', 'austria', 'russia', 'turkey'], 1901),
  ('1900',      array['britain', 'france', 'germany', 'italy', 'austria', 'russia', 'turkey'], 1900)
on conflict (id) do update
  set powers = excluded.powers, starting_year = excluded.starting_year;

-- ── start_game (re-issues 132) ─────────────────────────────────────────────────
-- Reads the map row; also uses lock_owned_game / setting_bool / game_nations (134).
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
         deadline     = public.phase_deadline(g.settings, 'movement', now()),
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

-- ── join_public_game (re-issues 104) ───────────────────────────────────────────
-- A lobby is full at the map's power count (7 for an unknown map, as before).
create or replace function public.join_public_game(game_id uuid)
returns jsonb as $$
declare
  game_row     public.games;
  player_count int;
  max_players  int;
  user_meta    jsonb;
  player_info  jsonb;
begin
  select * into game_row from public.games where id = game_id;

  if game_row is null then
    raise exception 'Game not found';
  end if;

  if game_row.phase != 'lobby' then
    raise exception 'Game is not accepting players';
  end if;

  if game_row.players ? (auth.uid()::text) then
    return game_row.players;
  end if;

  select count(*) into player_count
    from jsonb_object_keys(game_row.players);

  select coalesce(max(cardinality(m.powers)), 7) into max_players
    from public.maps m where m.id = game_row.map_id;

  if player_count >= max_players then
    raise exception 'Game is full';
  end if;

  select raw_user_meta_data into user_meta
    from auth.users where id = auth.uid();

  player_info = jsonb_build_object(
    'role', 'player',
    'display_name', coalesce(user_meta->>'full_name', user_meta->>'name'),
    'avatar_url', user_meta->>'avatar_url',
    'joined_at', now()
  );

  update public.games
    set players = players || jsonb_build_object(auth.uid()::text, player_info)
    where id = game_id;

  return (select players from public.games where id = game_id);
end;
$$ language plpgsql security definer;
