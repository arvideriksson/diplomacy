-- Draft (unsubmitted) orders, single-row model. A player has ONE orders row per
-- (game, round, nation); whether it counts is decided by games.ready, not by which
-- table it lives in. Readiness is on `games` on purpose — it is public (others may see
-- WHO has readied) while the order content in `public.orders` stays private until the
-- round resolves. So:
--
--   • Drafting (Phase 1, not ready): this RPC autosaves the order content into the row
--     and never touches games.ready. `public.orders` is not in the realtime publication
--     (games is), so a draft is never broadcast — autosave is silent and free.
--   • Submitting: goes through submit_orders (009/011), which writes the SAME row and
--     flips games.ready — that broadcast is desired (others see you readied).
--   • Adjudication: the Edge Function honors a round's orders only for nations that are
--     ready; an unsubmitted draft is treated as a hold. "Only submitted is considered."
--
-- This is why there is no separate drafts table and no draft→orders transfer: the row IS
-- the draft until ready flips. current_nation/the players map are as defined in 010.

create or replace function public.save_draft_orders(p_game_id uuid, p_orders jsonb)
returns void as $$
declare g public.games; me text;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;
  me := g.players -> (auth.uid()::text) ->> 'nation';
  if me is null then raise exception 'You are not a player with a nation in this game'; end if;
  if g.phase not in ('movement', 'retreat', 'build') then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then raise exception 'Round is resolving; orders are locked'; end if;

  -- Already submitted? Drafts are inert once ready — refuse so an autosave can never
  -- silently overwrite the committed set. Re-submission goes through submit_orders.
  if coalesce((g.ready ->> me)::boolean, false) then return; end if;

  insert into public.orders (game_id, year, season, phase, nation, orders, submitted_by, resolved)
  values (p_game_id, g.year, g.season, g.phase, me, coalesce(p_orders, '[]'::jsonb), auth.uid(), false)
  on conflict (game_id, year, season, phase, nation)
  do update set orders = excluded.orders, submitted_by = excluded.submitted_by, updated_at = now()
  where public.orders.resolved = false;
end;
$$ language plpgsql security definer;

grant execute on function public.save_draft_orders(uuid, jsonb) to authenticated;
