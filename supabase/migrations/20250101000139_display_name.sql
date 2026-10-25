-- Chosen display names.
--
-- A player picks their name on first sign-in (and can change it from the user menu).
-- It lives in auth.users.raw_user_meta_data.display_name, ahead of the provider's
-- full_name / name. Game rosters snapshot the name at join time (games.players), so a
-- change is copied into every game the user is in — otherwise old games would keep
-- showing the Google name.

-- The name to show for a user's metadata: the chosen one, else the provider's.
create or replace function public.user_display_name(p_meta jsonb)
returns text as $$
  select coalesce(p_meta ->> 'display_name', p_meta ->> 'full_name', p_meta ->> 'name');
$$ language sql immutable;

create or replace function public.set_display_name(p_name text)
returns text as $$
declare
  uid  text := auth.uid()::text;
  name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if char_length(name) < 2 or char_length(name) > 32 then
    raise exception 'Name must be 2–32 characters';
  end if;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}') || jsonb_build_object('display_name', name)
   where id = auth.uid();

  -- Roster entries are objects; a private-game invite can still hold a bare 'pending'.
  update public.games
     set players = jsonb_set(players, array[uid, 'display_name'], to_jsonb(name))
   where players ? uid
     and jsonb_typeof(players -> uid) = 'object';

  return name;
end;
$$ language plpgsql security definer;

grant execute on function public.set_display_name(text) to authenticated;

-- ── join_public_game (re-issues 138) — snapshot the chosen name ──────────────────
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
    'display_name', public.user_display_name(user_meta),
    'avatar_url', user_meta->>'avatar_url',
    'joined_at', now()
  );

  update public.games
    set players = players || jsonb_build_object(auth.uid()::text, player_info)
    where id = game_id;

  return (select players from public.games where id = game_id);
end;
$$ language plpgsql security definer;
