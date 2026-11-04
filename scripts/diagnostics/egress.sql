-- Read-only egress drivers (npm run live:egress). Egress itself isn't visible from SQL;
-- this shows what produces it, as rows (from pg_stat_statements, since its last reset)
-- and the byte size of the rows those queries ship:
--   statement — the client/API statements that returned the most rows (calls, rows, rows/call)
--   row_size  — average JSON bytes per row as clients receive it (not the compressed
--               on-disk size), and of the games columns that dominate it
--   writes    — updates/inserts per table: each games update is a full-row Realtime
--               broadcast to every subscriber of that game
--   realtime  — live postgres_changes subscriptions
select kind, detail from (
  select 'statement' as kind, s.detail from (
    select jsonb_build_object(
             'role', r.rolname, 'calls', st.calls, 'rows', st.rows,
             'rows_per_call', round(st.rows::numeric / greatest(st.calls, 1), 1),
             'query', left(regexp_replace(st.query, '\s+', ' ', 'g'), 220)) as detail
      from extensions.pg_stat_statements st
      join pg_roles r on r.oid = st.userid
     where r.rolname in ('authenticator', 'authenticated', 'anon', 'service_role', 'supabase_realtime_admin')
     order by st.rows desc limit 25) s
  union all
  select 'row_size', jsonb_build_object('table', 'games', 'rows', count(*),
           'avg_row_bytes', round(avg(octet_length(to_jsonb(g)::text))),
           'avg_snapshot_bytes', round(avg(octet_length(g.snapshot::text))),
           'avg_players_bytes', round(avg(octet_length(g.players::text))),
           'avg_settings_bytes', round(avg(octet_length(g.settings::text))),
           'total_bytes', sum(octet_length(to_jsonb(g)::text)))
    from public.games g
  union all
  select 'row_size', jsonb_build_object('table', 'games by phase', 'phase', phase, 'rows', count(*),
           'total_bytes', sum(octet_length(to_jsonb(g)::text)))
    from public.games g group by phase
  union all
  select 'row_size', jsonb_build_object('table', 'orders (resolved)', 'rows', count(*),
           'avg_row_bytes', round(avg(octet_length(to_jsonb(o)::text))), 'max_game_log_bytes',
           (select max(b) from (select sum(octet_length(to_jsonb(o2)::text)) b from public.orders o2 where resolved group by game_id) x))
    from public.orders o where resolved
  union all
  select 'row_size', jsonb_build_object('table', 'chat_messages', 'rows', count(*), 'avg_row_bytes', round(avg(octet_length(to_jsonb(m)::text))))
    from public.chat_messages m
  union all
  select 'row_size', jsonb_build_object('table', 'chat_channels', 'rows', count(*), 'avg_row_bytes', round(avg(octet_length(to_jsonb(c)::text))))
    from public.chat_channels c
  union all
  select 'writes', jsonb_build_object('table', relname, 'inserts', n_tup_ins, 'updates', n_tup_upd, 'hot_updates', n_tup_hot_upd)
    from pg_stat_user_tables where schemaname = 'public' and (n_tup_ins + n_tup_upd) > 0
  union all
  select 'realtime', jsonb_build_object('subscriptions', count(*), 'by_table',
           (select jsonb_object_agg(entity::text, n) from (select entity, count(*) n from realtime.subscription group by entity) e))
    from realtime.subscription
  union all
  select 'stats_since', jsonb_build_object('pg_stat_statements_reset', (select stats_reset from extensions.pg_stat_statements_info))
) q;
