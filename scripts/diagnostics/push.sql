-- Read-only push diagnostics (npm run live:diagnose-push). One result set:
--   player   — each player in a running game: their push subscriptions, by push service
--   response — the last pg_net replies (pg_net keeps ~6 h), which include notify's { sent, failed, removed }
--   message  — press messages in the last 24 h, per game
--   game     — each running game's round and when the board last changed
--   queue    — pg_net requests not yet sent
--   config   — the engine_config URL and the SHA-256 of its secret (compare with the
--              digest `npm run live:secrets-list` shows for ADJUDICATOR_SECRET)
select kind, at, detail from (
  select 'player' as kind, null::timestamptz as at,
         jsonb_build_object(
           'game', g.name,
           'nation', p.value ->> 'nation',
           'name', coalesce(u.raw_user_meta_data ->> 'display_name', u.raw_user_meta_data ->> 'full_name'),
           'subscriptions', (select count(*) from public.push_subscriptions s where s.user_id = p.key::uuid),
           'services', (select jsonb_agg(distinct split_part(s.endpoint, '/', 3))
                          from public.push_subscriptions s where s.user_id = p.key::uuid)) as detail
    from public.games g
    cross join jsonb_each(g.players) p
    left join auth.users u on u.id = p.key::uuid
   where public.is_order_phase(g.phase)
  union all
  select 'response', r.created,
         jsonb_build_object('status', r.status_code, 'error', r.error_msg, 'body', left(r.content, 200))
    from (select * from net._http_response order by created desc limit 15) r
  union all
  select 'game', g.updated_at,
         jsonb_build_object('game', g.name, 'round', g.season || ' ' || g.year || ' ' || g.phase,
                            'resolving_at', g.resolving_at,
                            'resolved_rounds', (select count(distinct (o.year, o.season, o.phase))
                                                  from public.orders o where o.game_id = g.id and o.resolved))
    from public.games g
   where public.is_order_phase(g.phase)
  union all
  select 'queue', null, jsonb_build_object('pending', count(*), 'urls', jsonb_agg(distinct q.url))
    from net.http_request_queue q
  union all
  select 'config', null,
         jsonb_build_object('function_url', e.function_url,
                            'secret_sha256', encode(sha256(convert_to(e.service_key, 'utf8')), 'hex'))
    from private.engine_config e
  union all
  select 'message', max(m.created_at),
         jsonb_build_object('game', g.name, 'count', count(*))
    from public.chat_messages m
    join public.chat_channels c on c.id = m.channel_id
    join public.games g on g.id = c.game_id
   where m.created_at > now() - interval '24 hours'
   group by g.name
) d
order by kind, at desc nulls last;
