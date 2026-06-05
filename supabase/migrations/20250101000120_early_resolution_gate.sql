-- Gate the early (all-powers-ready) resolution trigger behind the per-game
-- `settings.early_resolution` flag. When false, a game resolves only at its
-- deadline even if every power has submitted. Defaults true (prior behavior) for
-- any row missing the flag.
--
-- Re-issues tick_due_games() from 20250101000112_cron.sql with the gate added; the
-- scheduled cron job calls this function by name, so replacing it suffices.
create or replace function public.tick_due_games()
returns void as $$
declare
  cfg private.engine_config;
  g   record;
begin
  -- Reap stale locks from crashed/never-completed resolutions FIRST (see cron.sql).
  update public.games
     set resolving_at = null
   where resolving_at is not null
     and resolving_at < now() - interval '5 minutes';

  select * into cfg from private.engine_config where id;
  if cfg is null then return; end if;

  for g in
    select id
      from public.games
     where phase in ('movement', 'retreat', 'build')
       and resolving_at is null
       and (
             (deadline is not null and deadline <= now())
          or ( coalesce((settings ->> 'early_resolution')::boolean, true)
               and public.all_powers_ready(id) )
           )
     for update skip locked
  loop
    update public.games set resolving_at = now() where id = g.id;
    perform net.http_post(
      url     := cfg.function_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || cfg.service_key),
      body    := jsonb_build_object('game_id', g.id)
    );
  end loop;
end;
$$ language plpgsql security definer;
