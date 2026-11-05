-- The games list shows how a finished game ended: the agreed tie / concession
-- (games.result) or, for a solo, who won. The solo winner isn't stored anywhere; the
-- client works it out from the final supply-center ownership with the map's victory
-- rule (victoryFor), as the game view already does. So list_games now also returns
-- `result` and, for complete games only, the snapshot's supplyCenters (~34 short
-- entries) — still not the full snapshot. Complete games are only listed to the
-- people who were in them (unchanged from 152), so this adds a few hundred bytes per
-- finished game of your own.
--
-- `ready` now carries only the caller's own nation. Who else has readied is not
-- something a player should learn from the games list (the list only ever needed the
-- caller's flag, to show "Orders due").
--
-- The return type changes, so the function is dropped and recreated (and re-granted).

drop function if exists public.list_games();

create function public.list_games()
returns table (
  id uuid, name text, phase text, year integer, season text, map_id text,
  is_private boolean, created_by uuid, updated_at timestamptz, deadline timestamptz,
  ready jsonb, player_count integer, me jsonb,
  result jsonb, final_centers jsonb
)
language sql stable security invoker as $$
  select g.id, g.name, g.phase, g.year, g.season, g.map_id,
         g.is_private, g.created_by, g.updated_at, g.deadline,
         case when g.players -> (auth.uid()::text) ? 'nation'
              then jsonb_build_object(g.players -> (auth.uid()::text) ->> 'nation',
                                      coalesce(g.ready -> (g.players -> (auth.uid()::text) ->> 'nation'), 'false'::jsonb))
              else '{}'::jsonb end,
         (select count(*)::int from jsonb_object_keys(g.players)), g.players -> (auth.uid()::text),
         g.result,
         case when g.phase = 'complete' then g.snapshot -> 'supplyCenters' end
    from public.games g
   where g.phase <> 'complete' or g.players ? (auth.uid()::text) or g.created_by = auth.uid()
   order by g.updated_at desc;
$$;

grant execute on function public.list_games() to authenticated;
