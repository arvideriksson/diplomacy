-- Small shared helpers, and the current functions re-issued on top of them.
--
-- The same handful of expressions were repeated across many function bodies:
--   phase in ('movement', 'retreat', 'build')                 → is_order_phase(phase)
--   coalesce((settings ->> 'x')::boolean, <default>)           → setting_bool(settings, 'x', <default>)
--   array_agg(distinct value ->> 'nation') from jsonb_each(…)  → game_nations(players)
--   coalesce((ready ->> nation)::boolean, false)               → is_ready(ready, nation)
--   players -> (auth.uid()::text) ->> 'nation'                 → player_nation(players)
--   lock the game row + "only the creator" check               → lock_owned_game(id, message)
--
-- Every function below is re-issued from its CURRENT body (latest migration noted per
-- function) with only those substitutions; error messages and return semantics are
-- unchanged. Signatures are unchanged, so existing grants carry over. The helpers get
-- no grant (128 default privileges keep them private): they are only called from
-- security-definer functions, which run as the owner.
--
-- Two trigger functions become SECURITY DEFINER: triggers on public.games fire as the
-- client role on a direct lobby insert/update, and that role cannot execute the
-- (ungranted) helpers they call. This also fixes set_grace_ends_at from 133, which calls
-- grace_minutes() — created after 128 and so not executable by `authenticated` — and
-- would otherwise make every client-side game creation fail.
--
-- The games_due_idx partial index keeps its literal predicate; is_order_phase is an
-- inlinable immutable SQL function, so tick_due_games' qual still matches it.

-- ── helpers ───────────────────────────────────────────────────────────────────

-- A phase that takes orders (and so has a deadline and can resolve).
create or replace function public.is_order_phase(p_phase text)
returns boolean as $$
  select p_phase in ('movement', 'retreat', 'build');
$$ language sql immutable;

-- A boolean game setting, with the default for a missing key. Mirrors DEFAULT_SETTINGS.
create or replace function public.setting_bool(p_settings jsonb, p_key text, p_default boolean)
returns boolean as $$
  select coalesce((p_settings ->> p_key)::boolean, p_default);
$$ language sql immutable;

-- The nations assigned in a players map: sorted, distinct; null when none.
create or replace function public.game_nations(p_players jsonb)
returns text[] as $$
  select array_agg(distinct value ->> 'nation' order by value ->> 'nation')
    from jsonb_each(p_players)
   where value ->> 'nation' is not null;
$$ language sql immutable;

-- Has this nation readied (games.ready) for the current round?
create or replace function public.is_ready(p_ready jsonb, p_nation text)
returns boolean as $$
  select coalesce((p_ready ->> p_nation)::boolean, false);
$$ language sql immutable;

-- The calling user's nation in a players map (current_nation() without the lookup).
create or replace function public.player_nation(p_players jsonb)
returns text as $$
  select p_players -> (auth.uid()::text) ->> 'nation';
$$ language sql stable;

-- Lock a game row and check the caller created it. p_denied is the caller-specific
-- refusal message.
create or replace function public.lock_owned_game(
  p_game_id uuid,
  p_denied  text default 'Only the game creator can do that'
)
returns public.games as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null then raise exception 'Game not found'; end if;
  if g.created_by is distinct from auth.uid() then
    raise exception '%', p_denied;
  end if;
  return g;
end;
$$ language plpgsql security definer;

-- ── lock_hosted_game (re-issues 129) ───────────────────────────────────────────
create or replace function public.lock_hosted_game(p_game_id uuid)
returns public.games as $$
declare g public.games;
begin
  g := public.lock_owned_game(p_game_id);
  if not public.setting_bool(g.settings, 'host_controls', false) then
    raise exception 'Host controls are not enabled for this game';
  end if;
  return g;
end;
$$ language plpgsql security definer;

-- ── trigger functions ─────────────────────────────────────────────────────────

-- set_grace_ends_at (re-issues 133): body unchanged, now security definer (see above).
create or replace function public.set_grace_ends_at()
returns trigger as $$
begin
  new.grace_ends_at := new.deadline + make_interval(mins => public.grace_minutes(new.settings));
  return new;
end;
$$ language plpgsql security definer;

-- guard_host_controls (re-issues 129): setting_bool; security definer (see above).
create or replace function public.guard_host_controls()
returns trigger as $$
declare
  hc boolean := public.setting_bool(new.settings, 'host_controls', false);
begin
  if tg_op = 'UPDATE' then
    if old.phase <> 'lobby'
       and hc is distinct from public.setting_bool(old.settings, 'host_controls', false) then
      raise exception 'Host controls are fixed once the game has started';
    end if;
  end if;
  if hc and not new.is_private then
    raise exception 'Games with host controls must stay private';
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- create_public_channel (re-issues 127).
create or replace function public.create_public_channel()
returns trigger as $$
declare nations text[];
begin
  if public.setting_bool(new.settings, 'gunboat', false) then
    return new;  -- gunboat: no press, no public channel
  end if;

  nations := public.game_nations(new.players);

  if coalesce(array_length(nations, 1), 0) >= 1 then
    insert into public.chat_channels (game_id, members, is_public)
    values (new.id, nations, true)
    on conflict (game_id, members) where name is null do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- ── readiness / scheduling ────────────────────────────────────────────────────

-- all_powers_ready (re-issues 112).
create or replace function public.all_powers_ready(p_game_id uuid)
returns boolean as $$
declare
  g              public.games;
  active_nations text[];
  n              text;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then return false; end if;

  active_nations := public.game_nations(g.players);
  if active_nations is null then return false; end if;

  foreach n in array active_nations loop
    if not public.is_ready(g.ready, n) then return false; end if;
  end loop;
  return true;
end;
$$ language plpgsql security definer stable;

-- resolution_due (re-issues 133).
create or replace function public.resolution_due(g public.games)
returns boolean as $$
  select g.grace_ends_at <= now()
      or (public.all_powers_ready(g.id)
          and (   public.setting_bool(g.settings, 'early_resolution', true)
               or (g.deadline is not null and g.deadline <= now())));
$$ language sql stable security definer;

-- tick_due_games (re-issues 131).
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
     where public.is_order_phase(phase)
       and resolving_at is null
       and public.resolution_due(games)
     for update skip locked
  loop
    -- Unconfigured engine: nothing can be fired this tick.
    exit when not public.fire_adjudicator(g.id, '{}'::jsonb, false);
  end loop;
end;
$$ language plpgsql security definer;

-- maybe_resolve_now (re-issues 131).
create or replace function public.maybe_resolve_now(p_game_id uuid)
returns void as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null or g.resolving_at is not null then return; end if;
  if not public.is_order_phase(g.phase) then return; end if;
  if not public.resolution_due(g) then return; end if;

  perform public.fire_adjudicator(p_game_id, '{}'::jsonb, false);
end;
$$ language plpgsql security definer;

-- ── settings / gunboat ────────────────────────────────────────────────────────

-- is_gunboat (re-issues 127).
create or replace function public.is_gunboat(p_game_id uuid)
returns boolean as $$
  select public.setting_bool(settings, 'gunboat', false)
    from public.games where id = p_game_id;
$$ language sql security definer stable;

-- update_game_settings (re-issues 130). Now takes the row lock up front via
-- lock_owned_game; the trailing UPDATE took the same lock anyway.
create or replace function public.update_game_settings(p_game_id uuid, p_settings jsonb)
returns void as $$
declare
  g     public.games;
  patch jsonb;
begin
  g := public.lock_owned_game(p_game_id, 'Only the game creator can change settings');

  if g.phase = 'lobby' then
    patch := coalesce(p_settings, '{}'::jsonb);
  else
    if not public.setting_bool(g.settings, 'host_controls', false) then
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

-- ── host / creator actions ────────────────────────────────────────────────────

-- set_deadline (re-issues 129).
create or replace function public.set_deadline(p_game_id uuid, p_deadline timestamptz)
returns void as $$
declare g public.games;
begin
  g := public.lock_hosted_game(p_game_id);
  if not public.is_order_phase(g.phase) then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then
    raise exception 'Round is resolving; the deadline is locked';
  end if;
  update public.games set deadline = p_deadline, updated_at = now() where id = p_game_id;
end;
$$ language plpgsql security definer;

-- host_force_resolve (re-issues 129).
create or replace function public.host_force_resolve(p_game_id uuid)
returns void as $$
declare g public.games;
begin
  g := public.lock_hosted_game(p_game_id);
  if not public.is_order_phase(g.phase) then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then raise exception 'Round is already resolving'; end if;
  perform public.fire_adjudicator(p_game_id, '{}'::jsonb);
end;
$$ language plpgsql security definer;

-- host_revert_to (re-issues 129).
create or replace function public.host_revert_to(
  p_game_id uuid, p_year integer, p_season text, p_phase text)
returns void as $$
declare g public.games;
begin
  g := public.lock_hosted_game(p_game_id);
  if not (public.is_order_phase(g.phase) or g.phase = 'complete') then
    raise exception 'Game has not started';
  end if;
  if g.resolving_at is not null then raise exception 'Round is resolving; try again shortly'; end if;
  if not public.is_order_phase(p_phase) or p_season not in ('Spring', 'Fall') then
    raise exception 'Invalid round';
  end if;
  if public.round_rank(p_year, p_season, p_phase) >= public.round_rank(g.year, g.season, g.phase)
     and g.phase <> 'complete' then
    raise exception 'Can only revert to an earlier phase';
  end if;
  perform public.fire_adjudicator(p_game_id, jsonb_build_object(
    'action', 'revert',
    'target', jsonb_build_object('year', p_year, 'season', p_season, 'phase', p_phase)));
end;
$$ language plpgsql security definer;

-- kick_player (re-issues 105). Now locks the row up front via lock_owned_game.
create or replace function public.kick_player(game_id uuid, player_id uuid)
returns void as $$
begin
  perform public.lock_owned_game(game_id, 'Only the host can kick players');

  if player_id = auth.uid() then
    raise exception 'Cannot kick yourself';
  end if;

  update public.games
    set players = players - (player_id::text)
    where id = game_id;
end;
$$ language plpgsql security definer;

-- ── chat membership validation ────────────────────────────────────────────────

-- canonical_channel_members (re-issues 123).
create or replace function public.canonical_channel_members(
  p_game_id uuid,
  p_members text[]
) returns text[] as $$
declare
  me            text;
  canonical     text[];
  valid_nations text[];
begin
  me := public.current_nation(p_game_id);
  if me is null then raise exception 'You are not a player in this game'; end if;

  -- canonical = sorted + deduped + always includes the caller
  select array_agg(distinct n order by n)
    into canonical
    from unnest(p_members || array[me]) as n
    where n is not null;

  if coalesce(array_length(canonical, 1), 0) < 2 then
    raise exception 'A conversation needs at least two members';
  end if;

  select public.game_nations(g.players) into valid_nations
    from public.games g where g.id = p_game_id;

  if not (canonical <@ valid_nations) then
    raise exception 'All members must be nations in this game';
  end if;

  return canonical;
end;
$$ language plpgsql security definer stable;
