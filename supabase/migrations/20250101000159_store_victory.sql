-- A win on supply centers is stamped on games.result like a tie or a concession, so a
-- finished game's winner no longer depends on re-running the victory rules client-side
-- (a later rules change would otherwise rewrite past results):
--   { kind: 'victory', nations: [winner] (several for a shared win), centers,
--     year, season, phase }   -- the round whose resolution won it
-- The Edge Function passes it as p_result when a resolution completes the game.
-- Games that ended before this keep result = null and are still read off the board.

drop function public.apply_resolution(uuid, jsonb, jsonb, jsonb, jsonb, timestamptz, text[]);
create function public.apply_resolution(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } just resolved
  p_snapshot   jsonb,
  p_next       jsonb,        -- { phase, season, year } to advance to
  p_ready_init jsonb default '{}',  -- nations auto-readied for the opening phase
  p_claim      timestamptz default null,
  p_honoured   text[] default null,
  p_result     jsonb default null   -- set when this resolution ends the game
)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null then raise exception 'Game not found'; end if;
  if (g.year, g.season, g.phase)
     is distinct from ((p_round ->> 'year')::int, p_round ->> 'season', p_round ->> 'phase') then
    raise exception 'Stale resolution: the game is no longer at %', p_round;
  end if;
  if p_claim is not null and g.resolving_at is distinct from p_claim then
    raise exception 'Stale resolution: the claim was released or re-fired';
  end if;
  if p_result is not null and p_next ->> 'phase' is distinct from 'complete' then
    raise exception 'A result is only stamped when the game completes';
  end if;

  -- Unready nations held: blank their orders so the log matches the adjudication.
  update public.orders o
     set orders = '[]'::jsonb, updated_at = now()
   where o.game_id = p_game_id
     and o.year   = g.year
     and o.season = g.season
     and o.phase  = g.phase
     and o.resolved = false
     and case when p_honoured is null then not public.is_ready(g.ready, o.nation)
              else not (o.nation = any(p_honoured)) end;

  update public.orders
     set resolved = true, updated_at = now()
   where game_id = p_game_id
     and year   = g.year
     and season = g.season
     and phase  = g.phase
     and resolved = false;

  perform public.commit_board(p_game_id, p_snapshot, p_next, p_ready_init);
  -- commit_board clears result; a winning resolution stamps it straight back.
  if p_result is not null then
    update public.games set result = p_result where id = p_game_id;
  end if;
  perform public.settle_draw(p_game_id);
end;
$$;
grant execute on function public.apply_resolution(uuid, jsonb, jsonb, jsonb, jsonb, timestamptz, text[], jsonb)
  to service_role;
