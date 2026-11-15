-- Guest spectators: a visitor who hasn't signed in (the `anon` role) can browse and
-- watch public games, read-only. Everything a guest can see, any signed-in non-member
-- already sees; every write path stays `authenticated`-only, so joining, creating,
-- ordering and press still need an account.
--
--   1. games: the player-readable columns (all but `ready`, see 154) of public games.
--   2. orders: resolved orders of those games (the history view), never a current round.
--   3. realtime: the game:<id> Broadcast topic for those games (live board pushes).
--   4. RPCs: list_games (security invoker, so RLS above scopes it to public games) and
--      game_readiness (same visibility rule; with no auth.uid() it only ever returns the
--      public grace-period `waiting` list).

-- ── 1. games ─────────────────────────────────────────────────────────────────────
grant select (
  id, name, phase, year, season, players, created_by, created_at, updated_at,
  is_private, settings, map_id, deadline, snapshot, resolving_at, grace_ends_at, result
) on public.games to anon;

drop policy if exists "Guests can view public games" on public.games;
create policy "Guests can view public games"
  on public.games for select
  to anon
  using (not is_private);

-- ── 2. orders ────────────────────────────────────────────────────────────────────
-- The subquery runs under the guest's RLS, so only public games' history shows.
drop policy if exists "orders_select_resolved_guest" on public.orders;
create policy "orders_select_resolved_guest"
  on public.orders for select
  to anon
  using (resolved = true and exists (select 1 from public.games g where g.id = game_id));

-- ── 3. realtime ──────────────────────────────────────────────────────────────────
drop policy if exists "game_realtime_receive_guest" on realtime.messages;
create policy "game_realtime_receive_guest"
  on realtime.messages for select to anon
  using (
    case when topic like 'game:%'
      then exists (select 1 from public.games g where g.id = split_part(topic, ':', 2)::uuid)
      else false
    end
  );

-- ── 4. RPCs ──────────────────────────────────────────────────────────────────────
grant execute on function public.list_games() to anon;
grant execute on function public.game_readiness(uuid) to anon;
-- list_games calls my_ready for the viewer's own flag; with no auth.uid() it is null.
grant execute on function public.my_ready(uuid) to anon;
