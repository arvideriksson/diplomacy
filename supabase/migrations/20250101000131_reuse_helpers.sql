-- Route two sets of re-issued functions back through the helpers they bypassed.
--
-- 1. 130_grace_period.sql re-issued tick_due_games() and maybe_resolve_now() with
--    the engine_config lookup + net.http_post inlined, duplicating fire_adjudicator()
--    from 129_host_controls.sql. Both now call the helper, so the Edge Function URL,
--    auth header and request body are built in one place.
-- 2. 127_gunboat_no_press.sql re-issued get_or_create_channel() and
--    create_named_channel() from their pre-123 bodies, re-inlining the member
--    validation that 123_chat_member_helper.sql moved into canonical_channel_members().
--    Channels and drafts share that dedup key, so all three RPCs must go through the
--    helper again. The gunboat guard from 127 is kept.

-- ── fire_adjudicator: optional non-strict mode ──────────────────────────────────
-- Host actions want a missing engine_config to raise (the host sees the error); the
-- cron tick and the submit path want it to be a silent no-op, as before. Returns
-- whether the request was sent. The signature changes, so drop and recreate; it has
-- never been granted to clients and default privileges (128) keep it that way.
drop function public.fire_adjudicator(uuid, jsonb);

create function public.fire_adjudicator(
  p_game_id uuid,
  p_body    jsonb   default '{}',
  p_strict  boolean default true
)
returns boolean as $$
declare cfg private.engine_config;
begin
  select * into cfg from private.engine_config where id;
  if cfg is null then
    if p_strict then raise exception 'The adjudicator is not configured'; end if;
    return false;
  end if;

  update public.games set resolving_at = now() where id = p_game_id;
  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || cfg.service_key),
    body    := jsonb_build_object('game_id', p_game_id) || coalesce(p_body, '{}'::jsonb)
  );
  return true;
end;
$$ language plpgsql security definer;

-- ── tick_due_games (re-issues 130) ─────────────────────────────────────────────
create or replace function public.tick_due_games()
returns void as $$
declare g record;
begin
  -- Reap stale locks from crashed/never-completed resolutions FIRST (see cron.sql).
  update public.games
     set resolving_at = null
   where resolving_at is not null
     and resolving_at < now() - interval '5 minutes';

  for g in
    select id
      from public.games
     where phase in ('movement', 'retreat', 'build')
       and resolving_at is null
       and public.resolution_due(games)
     for update skip locked
  loop
    -- Unconfigured engine: nothing can be fired this tick.
    exit when not public.fire_adjudicator(g.id, '{}'::jsonb, false);
  end loop;
end;
$$ language plpgsql security definer;

-- ── maybe_resolve_now (re-issues 130) ──────────────────────────────────────────
-- fire_adjudicator expects the caller to have checked resolving_at under a row lock,
-- so take one here (the calling submit has usually locked the row already).
create or replace function public.maybe_resolve_now(p_game_id uuid)
returns void as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null or g.resolving_at is not null then return; end if;
  if g.phase not in ('movement', 'retreat', 'build') then return; end if;
  if not public.resolution_due(g) then return; end if;

  perform public.fire_adjudicator(p_game_id, '{}'::jsonb, false);
end;
$$ language plpgsql security definer;

-- ── host_force_resolve / host_revert_to (129) ──────────────────────────────────
-- Unchanged bodies; they call fire_adjudicator(uuid, jsonb), which still resolves to
-- the new function via its defaults (strict).

-- ── channel RPCs (re-issue 127 on top of 123's helper) ─────────────────────────

create or replace function public.get_or_create_channel(
  p_game_id uuid,
  p_members text[]
) returns public.chat_channels as $$
declare
  canonical text[];
  ch        public.chat_channels;
begin
  if public.is_gunboat(p_game_id) then
    raise exception 'Press is disabled in this game (gunboat)';
  end if;

  canonical := public.canonical_channel_members(p_game_id, p_members);

  insert into public.chat_channels (game_id, members, is_public)
  values (p_game_id, canonical, false)
  on conflict (game_id, members) where name is null do nothing;

  select * into ch from public.chat_channels
   where game_id = p_game_id and members = canonical and name is null;

  return ch;
end;
$$ language plpgsql security definer;

create or replace function public.create_named_channel(
  p_game_id uuid,
  p_members text[],
  p_name    text
) returns public.chat_channels as $$
declare
  canonical text[];
  ch        public.chat_channels;
begin
  if public.is_gunboat(p_game_id) then
    raise exception 'Press is disabled in this game (gunboat)';
  end if;

  canonical := public.canonical_channel_members(p_game_id, p_members);

  if p_name is null or length(trim(p_name)) = 0 then raise exception 'A name is required'; end if;
  if length(p_name) > 60 then raise exception 'Name too long (max 60 characters)'; end if;

  insert into public.chat_channels (game_id, members, is_public, name)
  values (p_game_id, canonical, false, trim(p_name))
  returning * into ch;

  return ch;
end;
$$ language plpgsql security definer;
