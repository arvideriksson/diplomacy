-- Single-row consistency fix. In the single-row model a nation's draft lives in its
-- orders row until it readies; the adjudicator (Edge Function) honors a row only if the
-- nation is ready and treats an unsubmitted draft as a hold. But apply_resolution marks
-- EVERY row of the round resolved, so those ignored drafts leaked into the resolved log
-- — and the client's history replay (fetchResolvedLog → replayFrames) re-adjudicated
-- with them, drawing phantom arrows for moves that were never executed and reconstructing
-- wrong historical boards.
--
-- Fix: when committing a resolution, blank the orders of nations that were NOT ready for
-- the round before freezing it, so the immutable log records exactly what was
-- adjudicated (unsubmitted draft → hold). games.ready is read before it's reset in the
-- same function, and uses the same readiness predicate as the adjudicator's filter.
--
-- Re-creates apply_resolution from 011 with the added blanking step; body otherwise
-- identical. Past rounds resolved before this migration cannot be repaired — games.ready
-- was already reset, so which nations were ready is unrecoverable.
create or replace function public.apply_resolution(
  p_game_id  uuid,
  p_round    jsonb,        -- { year, season, phase } just resolved
  p_snapshot jsonb,
  p_units    jsonb,
  p_next     jsonb,        -- { phase, season, year } to advance to
  p_deadline timestamptz
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
     and not coalesce((g.ready ->> o.nation)::boolean, false);

  update public.orders
     set resolved = true, updated_at = now()
   where game_id = p_game_id
     and year   = (p_round->>'year')::int
     and season =  p_round->>'season'
     and phase  =  p_round->>'phase'
     and resolved = false;

  update public.games
     set snapshot     = p_snapshot,
         units        = p_units,
         phase        = p_next->>'phase',
         season       = p_next->>'season',
         year         = (p_next->>'year')::int,
         deadline     = p_deadline,
         ready        = '{}'::jsonb,
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;
