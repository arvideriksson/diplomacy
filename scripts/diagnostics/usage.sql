-- Read-only free-tier usage snapshot (npm run live:usage). One result set:
--   database — total database size vs the 500 MB free-tier cap
--   table    — the ten largest tables (data + indexes + toast)
--   storage  — File Storage objects and bytes, per bucket (1 GB cap)
--   games    — games by phase, and how many were created in the last 30 days
--   activity — chat messages, resolved rounds and users over the last 30 days
-- Egress and Edge Function invocations are not visible from SQL: see the dashboard's Usage page.
select kind, detail from (
  select 'database' as kind,
         jsonb_build_object('size', pg_size_pretty(pg_database_size(current_database())),
                            'bytes', pg_database_size(current_database()),
                            'pct_of_500MB', round(100.0 * pg_database_size(current_database()) / (500 * 1024 * 1024), 1)) as detail
  union all
  select 'table', t.detail from (
    select jsonb_build_object('table', n.nspname || '.' || c.relname,
                              'size', pg_size_pretty(pg_total_relation_size(c.oid)),
                              'rows_est', c.reltuples::bigint) as detail
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema')
     order by pg_total_relation_size(c.oid) desc limit 10) t
  union all
  select 'storage', jsonb_build_object('bucket', bucket_id, 'objects', count(*),
                                       'size', pg_size_pretty(coalesce(sum((metadata ->> 'size')::bigint), 0)))
    from storage.objects group by bucket_id
  union all
  select 'games', jsonb_build_object('phase', phase, 'count', count(*),
                                     'created_30d', count(*) filter (where created_at > now() - interval '30 days'))
    from public.games group by phase
  union all
  select 'activity', jsonb_build_object(
           'chat_messages_30d', (select count(*) from public.chat_messages where created_at > now() - interval '30 days'),
           'chat_messages_total', (select count(*) from public.chat_messages),
           'order_rows_total', (select count(*) from public.orders),
           'resolved_order_rows', (select count(*) from public.orders where resolved),
           'users', (select count(*) from auth.users),
           'users_active_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'))
) s;
