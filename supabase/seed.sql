-- Local stack only (see [db.seed] in config.toml) — never applied to the live project.
--
-- Points the scheduler at the locally served adjudicator. pg_net calls out from the
-- db container, so it reaches the API gateway by its Docker network alias (`kong`),
-- not localhost:54321. The secret matches [edge_runtime.secrets] in config.toml.
insert into private.engine_config (function_url, service_key)
values ('http://kong:8000/functions/v1/adjudicate', 'local-dev-adjudicator-secret')
on conflict (id) do update
  set function_url = excluded.function_url, service_key = excluded.service_key;
