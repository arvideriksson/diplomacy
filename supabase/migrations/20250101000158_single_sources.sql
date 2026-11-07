-- One source of truth for a few rules the audit found split or contradicted:
--   1. submit_orders always readies: there is no un-ready path (CLAUDE.md). p_ready
--      stays in the signature for old clients but must be true.
--   2. grace_minutes falls back to the *effective* movement timer, so a movement timer
--      of 0 (meaning "default 24h" to phase_timer_minutes) no longer means "no grace".
--   3. list_games returns grace_ends_at, so the game list can show the grace countdown
--      the board shows instead of "Resolving" for the whole grace period.
-- All new SECURITY DEFINER functions pin search_path (see 157).

-- ── 1. submit_orders ─────────────────────────────────────────────────────────────
create or replace function public.submit_orders(
  p_game_id uuid,
  p_orders  jsonb,
  p_ready   boolean default true,
  p_year    integer default null,
  p_season  text    default null,
  p_phase   text    default null
)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  g         public.games;
  my_nation text;
begin
  if p_ready is distinct from true then
    raise exception 'Orders are submitted ready; save a draft with save_draft_orders';
  end if;
  g := public.order_write_guard(p_game_id, p_year, p_season, p_phase, true);
  my_nation := public.player_nation(g.players);

  perform public.upsert_own_orders(g, my_nation, p_orders);

  update public.games
     set ready = ready || jsonb_build_object(my_nation, true)
   where id = p_game_id;

  -- Last power in? Resolve immediately rather than waiting for the cron tick.
  perform public.maybe_resolve_now(p_game_id);
end;
$$;

-- ── 2. grace_minutes ─────────────────────────────────────────────────────────────
-- settings.grace_period when set (0 = no grace), else one movement timer as
-- phase_timer_minutes reads it.
create or replace function public.grace_minutes(p_settings jsonb)
returns integer as $$
  select greatest(0, coalesce(
    (p_settings ->> 'grace_period')::int,
    public.phase_timer_minutes(p_settings, 'movement')));
$$ language sql immutable;

-- ── 3. list_games + grace_ends_at ────────────────────────────────────────────────
drop function if exists public.list_games();
create function public.list_games()
returns table (
  id uuid, name text, phase text, year integer, season text, map_id text,
  is_private boolean, created_by uuid, updated_at timestamptz, deadline timestamptz,
  grace_ends_at timestamptz,
  ready jsonb, player_count integer, me jsonb,
  result jsonb, final_centers jsonb
)
language sql stable security invoker as $$
  select g.id, g.name, g.phase, g.year, g.season, g.map_id,
         g.is_private, g.created_by, g.updated_at, g.deadline,
         g.grace_ends_at,
         case when g.players -> (auth.uid()::text) ? 'nation'
              then jsonb_build_object(g.players -> (auth.uid()::text) ->> 'nation',
                                      coalesce(public.my_ready(g.id), false))
              else '{}'::jsonb end,
         (select count(*)::int from jsonb_object_keys(g.players)), g.players -> (auth.uid()::text),
         g.result,
         case when g.phase = 'complete' then g.snapshot -> 'supplyCenters' end
    from public.games g
   where g.phase <> 'complete' or g.players ? (auth.uid()::text) or g.created_by = auth.uid()
   order by g.updated_at desc;
$$;
grant execute on function public.list_games() to authenticated;
