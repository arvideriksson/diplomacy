-- npm run live:ping-notify: the database calls notify (via pg_net, with the engine_config
-- secret) for a user that doesn't exist, so nothing is sent. A healthy pipeline answers
-- {"sent":0,...} with 200 — read it with `npm run live:diagnose-push` a few seconds later.
select public.push_notify(array[gen_random_uuid()], '{"title": "ping"}'::jsonb);
