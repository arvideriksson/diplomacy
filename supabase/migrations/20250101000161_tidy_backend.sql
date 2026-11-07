-- Backend tidy-ups from the audit:
--   1. games_settings_valid (added NOT VALID in 157) now checks every existing row too.
--      If a malformed legacy row exists this migration fails as a whole and changes
--      nothing — fix that row, then push again.
--   2. Admins come from a private.admins table instead of an email hard-coded in is_admin.
--   3. anon loses its column grant on games: the games select policy is `to authenticated`
--      only, so anon could never read a row anyway.
--   4. private.engine_config.service_key is renamed adjudicator_secret (it holds the
--      ADJUDICATOR_SECRET, never the service-role key), and the two copies of the Edge
--      Function call become one helper, call_edge_function.

-- ── 1. validate the settings constraint ──────────────────────────────────────────
alter table public.games validate constraint games_settings_valid;

-- ── 2. admins ────────────────────────────────────────────────────────────────────
create table if not exists private.admins (
  email text primary key
);
insert into private.admins (email) values ('arvid.f.eriksson@gmail.com')
on conflict (email) do nothing;

create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from auth.users u join private.admins a on a.email = u.email
     where u.id = auth.uid());
$$;

-- ── 3. no anon reads of games ────────────────────────────────────────────────────
revoke select on public.games from anon;

-- ── 4. engine_config.adjudicator_secret + one Edge Function caller ───────────────
alter table private.engine_config rename column service_key to adjudicator_secret;

-- POST `body` to the Edge Function `name` (adjudicate, notify), reached through the
-- engine_config row: its URL with the last segment swapped for `name`, and the shared
-- ADJUDICATOR_SECRET as the bearer token. Returns false when the engine isn't configured.
create or replace function public.call_edge_function(p_name text, p_body jsonb)
returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare cfg private.engine_config;
begin
  select * into cfg from private.engine_config where id;
  if cfg is null then return false; end if;
  perform net.http_post(
    url     := regexp_replace(cfg.function_url, '[^/]+$', p_name),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || cfg.adjudicator_secret),
    body    := p_body);
  return true;
end;
$$;

create or replace function public.fire_adjudicator(
  p_game_id uuid,
  p_body    jsonb   default '{}',
  p_strict  boolean default true
)
returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from private.engine_config where id) then
    if p_strict then raise exception 'The adjudicator is not configured'; end if;
    return false;
  end if;
  update public.games set resolving_at = now() where id = p_game_id;
  return public.call_edge_function('adjudicate',
    jsonb_build_object('game_id', p_game_id) || coalesce(p_body, '{}'::jsonb));
end;
$$;

-- Push to these users' subscriptions. Unconfigured engine or nobody to tell: a no-op.
create or replace function public.push_notify(p_user_ids uuid[], p_payload jsonb)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if coalesce(array_length(p_user_ids, 1), 0) = 0 then return; end if;
  perform public.call_edge_function('notify',
    jsonb_build_object('user_ids', to_jsonb(p_user_ids), 'payload', p_payload));
end;
$$;
