-- Stop storing provider profile pictures. The client draws a lettered avatar instead,
-- so games.players no longer snapshots auth metadata's avatar_url: join_public_game
-- (re-issues 139) leaves it out, and existing roster entries are scrubbed.

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
    'joined_at', now()
  );

  update public.games
    set players = players || jsonb_build_object(auth.uid()::text, player_info)
    where id = game_id;

  return (select players from public.games where id = game_id);
end;
$$ language plpgsql security definer;

-- Roster entries are objects; a private-game invite can still hold a bare 'pending'.
update public.games g
   set players = (
     select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' then v - 'avatar_url' else v end)
       from jsonb_each(g.players) as e(k, v)
   )
 where exists (
   select 1 from jsonb_each(g.players) as e(k, v)
    where jsonb_typeof(v) = 'object' and v ? 'avatar_url'
 );
