-- Cut egress on the three paths that dominate it (scripts/diagnostics/egress.sql):
--
-- 1. list_games(): the games list read every visible row with select('*') — each
--    public game anyone ever played, finished ones included, with its board snapshot
--    (~4.7 KB a row as JSON) — though the list only shows names, phases and counts.
--    Now: the list's columns only, the caller's own player entry instead of the whole
--    players map, and finished games only if the caller was in them.
-- 2/4. Game pushes: every update of a games row (each ready toggle, each resolving_at
--    stamp) streamed the full row to every subscriber via postgres_changes. Now a
--    trigger broadcasts on the game's PRIVATE topic `game:<id>`: the full row only when
--    something other than ready / resolving_at changed, a tiny {ready, updated_at}
--    patch when only readiness did, and nothing for a bare resolving_at stamp.
-- 3. chat_overview(): the press panel's catch-up made two requests per channel (latest
--    message + unread ids) plus a channel list and a read-cursor read. One call now
--    returns all of it for the caller's channels.
--
-- Both read functions are SECURITY INVOKER: they run under the caller's RLS, so they
-- can't return anything the caller couldn't already read table by table. chat_overview
-- additionally filters to channels the caller's nation is a member of, so it stays
-- safe even if someone later makes it SECURITY DEFINER.

-- ── 1. games list ────────────────────────────────────────────────────────────────
create or replace function public.list_games()
returns table (
  id uuid, name text, phase text, year integer, season text, map_id text,
  is_private boolean, created_by uuid, updated_at timestamptz, deadline timestamptz,
  ready jsonb, player_count integer, me jsonb
)
language sql stable security invoker as $$
  select g.id, g.name, g.phase, g.year, g.season, g.map_id,
         g.is_private, g.created_by, g.updated_at, g.deadline,
         g.ready, (select count(*)::int from jsonb_object_keys(g.players)), g.players -> (auth.uid()::text)
    from public.games g
   where g.phase <> 'complete' or g.players ? (auth.uid()::text) or g.created_by = auth.uid()
   order by g.updated_at desc;
$$;

grant execute on function public.list_games() to authenticated;

-- ── 2/4. game pushes over a private Broadcast topic ─────────────────────────────
create or replace function public.broadcast_game_change()
returns trigger as $$
declare
  -- Columns whose change alone doesn't warrant re-sending the row.
  quiet constant text[] := array['ready', 'resolving_at', 'updated_at'];
begin
  if (to_jsonb(new) - quiet) is distinct from (to_jsonb(old) - quiet) then
    perform realtime.send(to_jsonb(new), 'game', 'game:' || new.id::text, true);
  elsif new.ready is distinct from old.ready then
    perform realtime.send(jsonb_build_object('ready', new.ready, 'updated_at', new.updated_at),
                          'ready', 'game:' || new.id::text, true);
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists games_broadcast on public.games;
create trigger games_broadcast
  after update on public.games
  for each row execute function public.broadcast_game_change();

-- Receive: anyone who can read the game row (the games select policy, applied to the
-- caller inside the subquery). The topic is cast only once its prefix matches, like
-- the chat policies (142), so the policies never trip over each other's formats.
drop policy if exists "game_realtime_receive" on realtime.messages;
create policy "game_realtime_receive"
  on realtime.messages for select to authenticated
  using (
    case when topic like 'game:%'
      then exists (select 1 from public.games g where g.id = split_part(topic, ':', 2)::uuid)
      else false
    end
  );

-- postgres_changes on games is replaced by the topic above: stop decoding its WAL.
do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games') then
    alter publication supabase_realtime drop table public.games;
  end if;
end $$;

-- ── 3. press overview ────────────────────────────────────────────────────────────
-- Per channel of the caller's nation in a game (all, or just p_channel_ids): the
-- channel row, the caller's read cursor, the newest message, and the others' messages
-- after the cursor (id + time, newest first, capped like the client's UNREAD_CAP).
create or replace function public.chat_overview(p_game_id uuid, p_channel_ids bigint[] default null)
returns table (channel jsonb, last_read_at timestamptz, latest jsonb, unread jsonb)
language sql stable security invoker as $$
  with me as (select public.current_nation(p_game_id) as nation)
  select to_jsonb(c),
         r.last_read_at,
         (select to_jsonb(m) from public.chat_messages m
           where m.channel_id = c.id order by m.created_at desc limit 1),
         coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'created_at', u.created_at) order by u.created_at desc)
                     from (select m.id, m.created_at from public.chat_messages m
                            where m.channel_id = c.id and m.sender <> me.nation
                              and (r.last_read_at is null or m.created_at > r.last_read_at)
                            order by m.created_at desc limit 100) u), '[]'::jsonb)
    from public.chat_channels c
    cross join me
    left join public.chat_reads r on r.channel_id = c.id and r.nation = me.nation
   where c.game_id = p_game_id
     and me.nation = any(c.members)
     and (p_channel_ids is null or c.id = any(p_channel_ids))
   order by c.is_public desc, c.id;
$$;

grant execute on function public.chat_overview(uuid, bigint[]) to authenticated;
