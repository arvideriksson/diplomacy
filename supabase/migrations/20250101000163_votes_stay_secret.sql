-- End-of-game votes stay secret for good: a power sees only its own vote, even once the
-- game is complete (previously every player's was revealed then). How the game ended is
-- still public via games.result.
drop policy if exists "draw_votes_select" on public.draw_votes;
create policy "draw_votes_select"
  on public.draw_votes for select to authenticated
  using (nation = public.current_nation(game_id));
