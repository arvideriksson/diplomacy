-- One writer of the "commit a board" games update.
--
-- apply_resolution and apply_revert (both 132) ended in the same games update: store
-- the snapshot, move the phase pointer, stamp the next deadline, seed ready and release
-- the resolving lock. commit_board() owns that block now. Service-only: no grant, and it
-- is called solely from the two service-role functions below.
--
-- Both RPCs keep their signatures, so the service_role grants from 132 carry over.
--
-- apply_resolution keeps matching its round by (year, season, phase) equality rather
-- than round_rank(): equality uses orders_round_idx and is exact for any input, while
-- rank equality would scan the game's whole log. apply_revert already matches by rank,
-- because it needs the "> target" ordering anyway.
--
-- Also drops the orphaned apply_resolution(uuid, jsonb, jsonb, jsonb, jsonb, timestamptz)
-- overload from 117: 119 added a parameter with `create or replace`, which created a
-- second function instead of replacing it, and 122 / 132 only dropped the newer one. The
-- orphan writes the dropped games.units column, so it could only fail; 128 revoked its
-- EXECUTE and nothing calls it.

drop function if exists public.apply_resolution(uuid, jsonb, jsonb, jsonb, jsonb, timestamptz);

-- Commit a board and open p_round ({ year, season, phase }) on it. The deadline is
-- stamped from the game's settings; a 'complete' game has none.
create or replace function public.commit_board(
  p_game_id    uuid,
  p_snapshot   jsonb,
  p_round      jsonb,
  p_ready_init jsonb
)
returns void as $$
begin
  update public.games
     set snapshot     = p_snapshot,
         phase        = p_round ->> 'phase',
         season       = p_round ->> 'season',
         year         = (p_round ->> 'year')::int,
         deadline     = case when p_round ->> 'phase' = 'complete' then null
                             else public.phase_deadline(settings, p_round ->> 'phase', now()) end,
         ready        = coalesce(p_ready_init, '{}'::jsonb),
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql;

-- ── apply_resolution (re-issues 132) ───────────────────────────────────────────
create or replace function public.apply_resolution(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } just resolved
  p_snapshot   jsonb,
  p_next       jsonb,        -- { phase, season, year } to advance to
  p_ready_init jsonb default '{}'  -- nations auto-readied for the opening phase
)
returns void as $$
begin
  -- Unready nations held: blank their orders so the log matches the adjudication.
  update public.orders o
     set orders = '[]'::jsonb, updated_at = now()
    from public.games g
   where g.id = p_game_id
     and o.game_id = p_game_id
     and o.year   = (p_round->>'year')::int
     and o.season =  p_round->>'season'
     and o.phase  =  p_round->>'phase'
     and o.resolved = false
     and not public.is_ready(g.ready, o.nation);

  update public.orders
     set resolved = true, updated_at = now()
   where game_id = p_game_id
     and year   = (p_round->>'year')::int
     and season =  p_round->>'season'
     and phase  =  p_round->>'phase'
     and resolved = false;

  perform public.commit_board(p_game_id, p_snapshot, p_next, p_ready_init);
end;
$$ language plpgsql security definer;

-- ── apply_revert (re-issues 132) ───────────────────────────────────────────────
-- Rounds after the target are erased from the log; the target round's orders reopen
-- as unsubmitted drafts.
create or replace function public.apply_revert(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } to reopen
  p_snapshot   jsonb,        -- the board going into that round
  p_ready_init jsonb default '{}'
)
returns void as $$
declare
  target integer := public.round_rank(
    (p_round ->> 'year')::int, p_round ->> 'season', p_round ->> 'phase');
begin
  delete from public.orders
   where game_id = p_game_id
     and public.round_rank(year, season, phase) > target;

  update public.orders
     set resolved = false, updated_at = now()
   where game_id = p_game_id
     and public.round_rank(year, season, phase) = target;

  perform public.commit_board(p_game_id, p_snapshot, p_round, p_ready_init);
end;
$$ language plpgsql security definer;
