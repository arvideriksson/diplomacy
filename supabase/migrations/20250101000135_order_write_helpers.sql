-- One guard and one upsert for the two order-write RPCs.
--
-- save_draft_orders (118) and submit_orders (119) repeated the same preamble — load the
-- game, resolve the caller's nation, require an order-taking phase, refuse while the
-- round is resolving, reject a write stamped for a round that has since advanced — and
-- the same own-row upsert. The one intended difference is kept as a parameter: a stale
-- autosave is dropped silently, a stale submit raises so the client reloads.
--
-- Both RPCs keep their signatures, so the grants from 128 carry over. The helpers are
-- private (no grant) and run as the owner when called from the security-definer RPCs.

-- Validate an own-orders write and return the game row; returns null when the write is
-- stale and p_strict is false (the caller should then do nothing).
create or replace function public.order_write_guard(
  p_game_id uuid,
  p_year    integer,
  p_season  text,
  p_phase   text,
  p_strict  boolean
)
returns public.games as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;
  if public.player_nation(g.players) is null then
    raise exception 'You are not a player with a nation in this game';
  end if;
  if not public.is_order_phase(g.phase) then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then raise exception 'Round is resolving; orders are locked'; end if;

  -- Stale write (the round advanced under an in-flight request). Round params default
  -- to null (guard skipped) for backward compatibility.
  if p_year is not null
     and (g.year, g.season, g.phase) is distinct from (p_year, p_season, p_phase) then
    if p_strict then raise exception 'Round has advanced; reload before submitting'; end if;
    return null;
  end if;

  return g;
end;
$$ language plpgsql;

-- Write a nation's order set into its single row for the game's current round. A
-- resolved row is never touched (the log is immutable).
create or replace function public.upsert_own_orders(p_game public.games, p_nation text, p_orders jsonb)
returns void as $$
begin
  insert into public.orders (game_id, year, season, phase, nation, orders, submitted_by, resolved)
  values (p_game.id, p_game.year, p_game.season, p_game.phase, p_nation,
          coalesce(p_orders, '[]'::jsonb), auth.uid(), false)
  on conflict (game_id, year, season, phase, nation)
  do update set orders = excluded.orders, submitted_by = excluded.submitted_by, updated_at = now()
  where public.orders.resolved = false;
end;
$$ language plpgsql;

-- ── save_draft_orders (re-issues 118) ──────────────────────────────────────────
-- Autosave the caller's unsubmitted draft. Never touches games.ready, so it stays a
-- draft and is never broadcast.
create or replace function public.save_draft_orders(
  p_game_id uuid,
  p_orders  jsonb,
  p_year    integer default null,
  p_season  text    default null,
  p_phase   text    default null
)
returns void as $$
declare g public.games; me text;
begin
  g := public.order_write_guard(p_game_id, p_year, p_season, p_phase, false);
  if g.id is null then return; end if;  -- stale: the round moved on
  me := public.player_nation(g.players);

  -- Already submitted? Drafts are inert once ready — refuse so an autosave can never
  -- silently overwrite the committed set. Re-submission goes through submit_orders.
  if public.is_ready(g.ready, me) then return; end if;

  perform public.upsert_own_orders(g, me, p_orders);
end;
$$ language plpgsql security definer;

-- ── submit_orders (re-issues 119) ──────────────────────────────────────────────
-- Upsert the caller's orders for the current round and set (or clear) ready.
create or replace function public.submit_orders(
  p_game_id uuid,
  p_orders  jsonb,
  p_ready   boolean default false,
  p_year    integer default null,
  p_season  text    default null,
  p_phase   text    default null
)
returns void as $$
declare
  g         public.games;
  my_nation text;
begin
  g := public.order_write_guard(p_game_id, p_year, p_season, p_phase, true);
  my_nation := public.player_nation(g.players);

  perform public.upsert_own_orders(g, my_nation, p_orders);

  update public.games
     set ready = case when p_ready then ready || jsonb_build_object(my_nation, true)
                      else ready - my_nation end,
         updated_at = now()
   where id = p_game_id;

  -- Last power in? Resolve immediately rather than waiting for the cron tick.
  if p_ready then perform public.maybe_resolve_now(p_game_id); end if;
end;
$$ language plpgsql security definer;
