-- Drop the redundant games.units column.
--
-- `units` (from 101_schema.sql) and `snapshot` (from 108_turn_engine_schema.sql) both
-- carried the full board: apply_resolution wrote BOTH every resolution, even though
-- `units` is just `snapshot.units`. Clients and the adjudicator read the snapshot and
-- only ever fell back to `units` when no snapshot existed — i.e. the opening movement
-- phase before the first resolution. That state is exactly the map's opening position,
-- which `initialBoard(map_id)` reconstructs deterministically, so the fallback needs no
-- stored units at all. startGame now seeds a `snapshot` (initialBoard) instead of units.
--
-- No data backfill is required: every game with a resolution already has a snapshot, and
-- every game without one is at its (reconstructable) opening position.
--
-- Re-creates apply_resolution from 119 WITHOUT the p_units parameter / units write; body
-- otherwise identical. The Edge Function no longer passes p_units.

drop function if exists public.apply_resolution(
  uuid, jsonb, jsonb, jsonb, jsonb, timestamptz, jsonb);

create or replace function public.apply_resolution(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } just resolved
  p_snapshot   jsonb,
  p_next       jsonb,        -- { phase, season, year } to advance to
  p_deadline   timestamptz,
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
         phase        = p_next->>'phase',
         season       = p_next->>'season',
         year         = (p_next->>'year')::int,
         deadline     = p_deadline,
         ready        = coalesce(p_ready_init, '{}'::jsonb),
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

-- Now redundant: snapshot is the single authoritative board.
alter table public.games drop column if exists units;
