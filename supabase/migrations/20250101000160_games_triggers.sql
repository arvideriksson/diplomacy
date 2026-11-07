-- games triggers, consolidated. Before this, seven row triggers on public.games spread one
-- update across guards, derived columns, a broadcast and round side effects, with the
-- "did anything that matters change" list copied twice. Now:
--
--   games_before_write  (BEFORE INSERT OR UPDATE) — invariants, in one stated order:
--       1. client guard: privacy, map and settings are fixed once the game starts
--       2. host controls: fixed once started, and only on private games
--       3. derived: grace_ends_at = deadline + grace;  updated_at, unless only quiet
--          columns (ready, resolving_at) changed
--   games_broadcast     (AFTER UPDATE) — unchanged: the row (without ready), or during a
--       grace period the waiting list
--
-- Round side effects are no longer triggers: only start_game, commit_board and
-- settle_draw change a game's round, and each now says what follows from it
-- (announce_round: the "new round" / "game over" push; open_public_channel at start).
-- Writers no longer set updated_at themselves; the before-write trigger owns it.

-- ── shared helper ────────────────────────────────────────────────────────────────
-- Whether a games update changed anything players see: every column except the quiet
-- ones (readiness is secret; the claim is bookkeeping; updated_at follows from this).
create or replace function public.game_row_changed(o public.games, n public.games)
returns boolean as $$
  select (to_jsonb(n) - array['ready', 'resolving_at', 'updated_at'])
         is distinct from (to_jsonb(o) - array['ready', 'resolving_at', 'updated_at']);
$$ language sql immutable;

-- ── 1. one BEFORE trigger ────────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: the client guard asks whether the writer is a player
-- (current_user anon/authenticated), which a definer function would hide. So the pure
-- helpers it calls must be executable by the writing roles.
grant execute on function public.setting_bool(jsonb, text, boolean),
                          public.grace_minutes(jsonb),
                          public.phase_timer_minutes(jsonb, text),
                          public.game_row_changed(public.games, public.games)
  to authenticated, service_role;

create or replace function public.games_before_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  hc boolean := public.setting_bool(new.settings, 'host_controls', false);
begin
  -- 1. Direct client writes can't change privacy, map or settings after the start
  --    (update_game_settings runs as its owner, so mid-game host edits pass).
  if tg_op = 'UPDATE'
     and current_user in ('anon', 'authenticated')
     and old.phase <> 'lobby'
     and (new.is_private, new.map_id, new.settings)
         is distinct from (old.is_private, old.map_id, old.settings) then
    raise exception 'Privacy, map and settings are locked once the game has started';
  end if;

  -- 2. Host controls are chosen in the lobby and need (and keep) a private game.
  if tg_op = 'UPDATE' and old.phase <> 'lobby'
     and hc is distinct from public.setting_bool(old.settings, 'host_controls', false) then
    raise exception 'Host controls are fixed once the game has started';
  end if;
  if hc and not new.is_private then
    raise exception 'Games with host controls must stay private';
  end if;

  -- 3. Derived columns.
  new.grace_ends_at := new.deadline + make_interval(mins => public.grace_minutes(new.settings));
  if tg_op = 'UPDATE' then
    new.updated_at := case when public.game_row_changed(old, new) then now() else old.updated_at end;
  end if;
  return new;
end;
$$;

drop trigger if exists games_guard_client_update on public.games;
drop trigger if exists games_guard_host_controls on public.games;
drop trigger if exists games_grace_ends_at on public.games;
drop trigger if exists games_updated_at on public.games;
create trigger games_before_write
  before insert or update on public.games
  for each row execute function public.games_before_write();

drop function if exists public.guard_client_game_update();
drop function if exists public.guard_host_controls();
drop function if exists public.set_grace_ends_at();
drop function if exists public.touch_game_updated_at();

-- ── 2. the broadcast, on the shared helper ───────────────────────────────────────
create or replace function public.broadcast_game_change()
returns trigger
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if public.game_row_changed(old, new) then
    perform realtime.send(to_jsonb(new) - 'ready', 'game', 'game:' || new.id::text, true);
  elsif new.ready is distinct from old.ready and public.in_grace(new) then
    perform realtime.send(jsonb_build_object('waiting', to_jsonb(public.unready_nations(new))),
                          'waiting', 'game:' || new.id::text, true);
  end if;
  return null;
end;
$$;

-- ── 3. round side effects, called by the functions that change the round ────────
-- The push for a game that just entered round `g`: whom it's waiting on for an order
-- phase, everyone when it's over.
create or replace function public.announce_round(g public.games)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if public.is_order_phase(g.phase) then
    perform public.push_notify(
      public.nation_users(g.players, public.unready_nations(g)),
      jsonb_build_object('title', g.name, 'body', public.round_label(g),
                         'url', '/game/' || g.id, 'tag', 'round:' || g.id));
  elsif g.phase = 'complete' then
    perform public.push_notify(
      public.nation_users(g.players, public.game_nations(g.players)),
      jsonb_build_object('title', g.name, 'body', 'Game over',
                         'url', '/game/' || g.id, 'tag', 'round:' || g.id));
  end if;
end;
$$;

-- The game's public press channel (all its powers), unless it's gunboat.
create or replace function public.open_public_channel(g public.games)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare nations text[] := public.game_nations(g.players);
begin
  if public.setting_bool(g.settings, 'gunboat', false) then return; end if;
  if coalesce(array_length(nations, 1), 0) >= 1 then
    insert into public.chat_channels (game_id, members, is_public)
    values (g.id, nations, true)
    on conflict (game_id, members) where name is null do nothing;
  end if;
end;
$$;

drop trigger if exists games_notify_new_round on public.games;
drop trigger if exists games_create_public_chat on public.games;
drop function if exists public.notify_new_round();
drop function if exists public.create_public_channel();

-- start_game (re-issues 143): opens the press channel and announces the first round.
create or replace function public.start_game(p_game_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  g           public.games;
  powers      text[];
  start_year  integer;
  random_mode boolean;
  free        text[];
  next_free   integer := 1;
  p           record;
  assigned    jsonb;
begin
  g := public.lock_owned_game(p_game_id, 'Only the game creator can start the game');
  if g.phase <> 'lobby' then raise exception 'Game has already started'; end if;

  select m.powers, m.starting_year into powers, start_year
    from public.maps m where m.id = g.map_id;
  if powers is null then raise exception 'Unknown map: %', g.map_id; end if;

  if (select count(*) from jsonb_object_keys(g.players)) > array_length(powers, 1) then
    raise exception 'Too many players for this map (max %)', array_length(powers, 1);
  end if;

  random_mode := public.setting_bool(g.settings, 'random_nations', false);

  -- Powers nobody validly claimed, shuffled.
  select coalesce(array_agg(pw order by random()), '{}') into free
    from unnest(powers) pw
   where random_mode
      or not (pw = any(coalesce(public.game_nations(g.players), '{}')));

  assigned := g.players;
  for p in select key as uid, value ->> 'nation' as claimed from jsonb_each(g.players) loop
    if random_mode or p.claimed is null or not (p.claimed = any(powers)) then
      assigned := jsonb_set(assigned, array[p.uid, 'nation'], to_jsonb(free[next_free]));
      next_free := next_free + 1;
    end if;
  end loop;

  update public.games
     set phase        = 'movement',
         year         = start_year,
         season       = 'Spring',
         players      = assigned,
         snapshot     = null,
         ready        = '{}'::jsonb,
         resolving_at = null,
         deadline     = public.first_turn_deadline(g.settings, now())
   where id = p_game_id
  returning * into g;

  perform public.open_public_channel(g);
  perform public.announce_round(g);
end;
$$;

-- commit_board (re-issues 141): announces the round it moves the game into.
create or replace function public.commit_board(
  p_game_id    uuid,
  p_snapshot   jsonb,
  p_round      jsonb,
  p_ready_init jsonb
)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare g public.games;
begin
  update public.games
     set snapshot     = p_snapshot,
         phase        = p_round ->> 'phase',
         season       = p_round ->> 'season',
         year         = (p_round ->> 'year')::int,
         deadline     = case when p_round ->> 'phase' = 'complete' then null
                             else public.phase_deadline(settings, p_round ->> 'phase', now()) end,
         ready        = coalesce(p_ready_init, '{}'::jsonb),
         result       = null,
         resolving_at = null
   where id = p_game_id
  returning * into g;
  -- Every commit (resolution or revert) moves the game to a different round.
  perform public.announce_round(g);
end;
$$;

-- settle_draw (re-issues 141): announces the end.
create or replace function public.settle_draw(p_game_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  g       public.games;
  outcome text[];
begin
  select * into g from public.games where id = p_game_id for update;
  if not found or not public.is_order_phase(g.phase) or g.resolving_at is not null then
    return false;
  end if;
  outcome := public.draw_outcome(g);
  if outcome is null then return false; end if;

  update public.games
     set phase      = 'complete',
         deadline   = null,
         ready      = '{}'::jsonb,
         result     = jsonb_build_object(
                        'kind',    case when cardinality(outcome) = 1 then 'concession' else 'draw' end,
                        'nations', to_jsonb(outcome),
                        'year',    g.year,
                        'season',  g.season,
                        'phase',   g.phase)
   where id = p_game_id
  returning * into g;
  perform public.announce_round(g);
  return true;
end;
$$;

-- update_game_settings (re-issues 144): updated_at is the trigger's.
create or replace function public.update_game_settings(p_game_id uuid, p_settings jsonb)
returns void
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
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
       where k in ('phase_timers', 'early_resolution', 'grace_period'));
  end if;

  update public.games
     set settings = settings || patch
   where id = p_game_id;
end;
$$;
