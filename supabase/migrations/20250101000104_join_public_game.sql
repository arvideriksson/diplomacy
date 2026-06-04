-- Allow joining public games via RPC (bypasses RLS update restriction)

create or replace function public.join_public_game(game_id uuid)
returns jsonb as $$
declare
  game_row public.games;
  player_count int;
  user_meta jsonb;
  player_info jsonb;
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

  if player_count >= 7 then
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

-- Allow a player to remove themselves from a game

create or replace function public.leave_game(game_id uuid)
returns void as $$
declare
  game_row public.games;
begin
  select * into game_row from public.games where id = game_id;

  if game_row is null then
    raise exception 'Game not found';
  end if;

  if game_row.created_by = auth.uid() then
    raise exception 'Host cannot leave the game';
  end if;

  update public.games
    set players = players - (auth.uid()::text)
    where id = game_id;
end;
$$ language plpgsql security definer;
