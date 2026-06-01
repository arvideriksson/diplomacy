-- Scheduler. pg_cron ticks every minute (pure SQL — never adjudicates) and, for
-- each due game, marks it in-flight and fires the adjudicator Edge Function via
-- pg_net. Exactly-once = `for update skip locked` + the `resolving_at` lock +
-- the function's idempotency guard + a stale-lock reaper.
--
-- Requires the pg_cron and pg_net extensions (enable in Supabase: Database →
-- Extensions). Note: on the free tier a project pauses after ~1 week idle, which
-- stops pg_cron — keep games active or add an external heartbeat.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the tick a near no-op when nothing is due.
create index if not exists games_due_idx
  on public.games (deadline)
  where phase in ('movement', 'retreat', 'build');

-- Edge Function URL + service key, kept out of the migration (no plaintext in VCS).
-- Insert one row out-of-band (SQL editor) or use Supabase Vault and read from there.
create schema if not exists private;
create table if not exists private.engine_config (
  id           boolean primary key default true check (id),
  function_url text not null,
  service_key  text not null
);

-- All active (nation-assigned) powers ready?
create or replace function public.all_powers_ready(p_game_id uuid)
returns boolean as $$
declare
  g               public.games;
  active_nations  text[];
  n               text;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then return false; end if;

  select array_agg(distinct value ->> 'nation')
    into active_nations
    from jsonb_each(g.players)
    where value ->> 'nation' is not null;
  if active_nations is null then return false; end if;

  foreach n in array active_nations loop
    if not coalesce((g.ready ->> n)::boolean, false) then return false; end if;
  end loop;
  return true;
end;
$$ language plpgsql security definer stable;

-- Claim due games and fire the Edge Function.
create or replace function public.tick_due_games()
returns void as $$
declare
  cfg private.engine_config;
  g   record;
begin
  select * into cfg from private.engine_config where id;
  if cfg is null then return; end if;

  -- reap stale locks from crashed resolutions so they retry
  update public.games
     set resolving_at = null
   where resolving_at is not null
     and resolving_at < now() - interval '5 minutes';

  for g in
    select id
      from public.games
     where phase in ('movement', 'retreat', 'build')
       and resolving_at is null
       and (
             (deadline is not null and deadline <= now())
          or public.all_powers_ready(id)
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

-- One job for all games.
select cron.schedule('diplomacy-tick', '* * * * *', $$select public.tick_due_games();$$);
