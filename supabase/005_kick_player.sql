create or replace function public.kick_player(game_id uuid, player_id uuid)
returns void as $$
declare
  game_row public.games;
begin
  select * into game_row from public.games where id = game_id;

  if game_row is null then
    raise exception 'Game not found';
  end if;

  if game_row.created_by != auth.uid() then
    raise exception 'Only the host can kick players';
  end if;

  if player_id = auth.uid() then
    raise exception 'Cannot kick yourself';
  end if;

  update public.games
    set players = players - (player_id::text)
    where id = game_id;
end;
$$ language plpgsql security definer;
