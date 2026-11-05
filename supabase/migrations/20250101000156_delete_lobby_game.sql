-- The host can delete their game while it's still a lobby. There was no way to: games
-- has no delete policy, and only the site-admin wipe existed. Once the game has started
-- it stays (its log is other players' history too).
--
-- Every table that references games (orders, chat_channels, chat_drafts, draw_votes,
-- private.deadline_reminders) cascades, so deleting the row is the whole cleanup.

create or replace function public.delete_lobby_game(p_game_id uuid)
returns void as $$
declare
  g public.games;
begin
  g := public.lock_owned_game(p_game_id, 'Only the host can delete the game');
  if g.phase <> 'lobby' then
    raise exception 'Only a game that hasn''t started can be deleted';
  end if;
  delete from public.games where id = p_game_id;
end;
$$ language plpgsql security definer;

grant execute on function public.delete_lobby_game(uuid) to authenticated;
