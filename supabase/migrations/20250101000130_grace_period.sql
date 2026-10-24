-- Grace period: a missed deadline no longer resolves the round on the spot.
--
-- Previously the cron backstop resolved a phase the moment its deadline passed, with
-- unready nations holding. Now a phase whose deadline passes while some power is still
-- unready enters a grace period: it resolves as soon as the last power submits —
-- regardless of the early_resolution toggle, which only governs resolving *before* the
-- deadline — or, failing that, when the grace period runs out (unready nations hold).
-- The adjudicator stamps the next deadline from the resolution time, so the schedule
-- simply shifts.
--
-- Grace length is settings.grace_period (minutes; 0 = none), defaulting to the game's
-- movement timer. The grace period itself is not stored — it is "deadline passed, not
-- yet resolved", which the client derives from games.deadline / games.ready / settings.

-- Mirrors graceMinutes() in src/lib/game.ts.
create or replace function public.grace_minutes(p_settings jsonb)
returns integer as $$
  select greatest(0, coalesce(
    (p_settings ->> 'grace_period')::int,
    (p_settings -> 'phase_timers' ->> 'movement')::int,
    1440));
$$ language sql immutable;

-- ── Due = grace ran out, or all ready and (early resolution on or deadline passed) ──
create or replace function public.resolution_due(g public.games)
returns boolean as $$
  select (g.deadline is not null
          and g.deadline + make_interval(mins => public.grace_minutes(g.settings)) <= now())
      or (public.all_powers_ready(g.id)
          and (   coalesce((g.settings ->> 'early_resolution')::boolean, true)
               or (g.deadline is not null and g.deadline <= now())));
$$ language sql stable security definer;

-- Re-issues tick_due_games() (120_early_resolution_gate.sql). The cron job calls it by
-- name, so replacing it suffices. A passed deadline alone no longer fires; the end of
-- its grace period does.
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
       and public.resolution_due(games)
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

-- Re-issues maybe_resolve_now() (119_early_resolution.sql): the submit that ends a
-- grace period fires the adjudicator at once, even with early resolution off.
create or replace function public.maybe_resolve_now(p_game_id uuid)
returns void as $$
declare cfg private.engine_config; g public.games;
begin
  select * into g from public.games where id = p_game_id;
  if g is null or g.resolving_at is not null then return; end if;
  if g.phase not in ('movement', 'retreat', 'build') then return; end if;
  if not public.resolution_due(g) then return; end if;

  select * into cfg from private.engine_config where id;
  if cfg is null then return; end if;

  update public.games set resolving_at = now() where id = p_game_id and resolving_at is null;
  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || cfg.service_key),
    body    := jsonb_build_object('game_id', p_game_id)
  );
end;
$$ language plpgsql security definer;

-- ── update_game_settings: grace_period is mutable mid-game (host controls) ─────
-- Re-issues 129_host_controls.sql with grace_period added to the mid-game whitelist.
create or replace function public.update_game_settings(p_game_id uuid, p_settings jsonb)
returns void as $$
declare
  g     public.games;
  patch jsonb;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;
  if g.created_by <> auth.uid() then
    raise exception 'Only the game creator can change settings';
  end if;

  if g.phase = 'lobby' then
    patch := coalesce(p_settings, '{}'::jsonb);
  else
    if not coalesce((g.settings ->> 'host_controls')::boolean, false) then
      raise exception 'Settings are locked once the game has started';
    end if;
    -- Mid-game: keep only the mutable keys from the supplied patch.
    patch := (
      select coalesce(jsonb_object_agg(k, p_settings -> k), '{}'::jsonb)
        from jsonb_object_keys(coalesce(p_settings, '{}'::jsonb)) k
       where k in ('phase_timers', 'early_resolution', 'allow_spectators', 'grace_period'));
  end if;

  update public.games
     set settings = settings || patch,
         updated_at = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;
