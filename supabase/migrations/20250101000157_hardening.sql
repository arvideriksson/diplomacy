-- Hardening pass from the codebase audit:
--   1. resolved orders are readable only for games the caller can see
--   2. kick_player / leave_game are lobby-only
--   3. join_public_game / claim_nation lock the game row (no double claims / overfill)
--   4. games.settings is type-checked, so one malformed game can't abort the cron tick
--   5. apply_resolution / apply_revert commit only over the claim they were fired for,
--      and blank exactly the nations the Edge Function did not honour
--   6. set_deadline refuses a null deadline
--   7. every SECURITY DEFINER function in public pins its search_path

-- ── 1. orders: resolved rows follow the games select policy ─────────────────────
-- The subquery runs under the caller's RLS, so a private game's history stays
-- private to its players and creator.
drop policy if exists "orders_select_own_or_resolved" on public.orders;
create policy "orders_select_own_or_resolved"
  on public.orders for select
  to authenticated
  using (
    (resolved = true and exists (select 1 from public.games g where g.id = game_id))
    or nation = public.current_nation(game_id)
  );

-- ── 2. roster changes are lobby-only ─────────────────────────────────────────────
-- Mid-game a missing player would silently drop out of game_nations(), and with it
-- out of readiness, draw votes and unready_nations.
create or replace function public.kick_player(game_id uuid, player_id uuid)
returns void as $$
declare g public.games;
begin
  g := public.lock_owned_game(game_id, 'Only the host can kick players');
  if g.phase <> 'lobby' then raise exception 'Game has already started'; end if;

  if player_id = auth.uid() then
    raise exception 'Cannot kick yourself';
  end if;

  update public.games
    set players = players - (player_id::text)
    where id = game_id;
end;
$$ language plpgsql security definer;

create or replace function public.leave_game(game_id uuid)
returns void as $$
declare
  game_row public.games;
begin
  select * into game_row from public.games where id = game_id for update;

  if game_row is null then
    raise exception 'Game not found';
  end if;
  if game_row.phase <> 'lobby' then
    raise exception 'Game has already started';
  end if;

  if game_row.created_by = auth.uid() then
    raise exception 'Host cannot leave the game';
  end if;

  update public.games
    set players = players - (auth.uid()::text)
    where id = game_id;
end;
$$ language plpgsql security definer;

-- ── 3. lobby writes lock the row ─────────────────────────────────────────────────
create or replace function public.join_public_game(game_id uuid)
returns jsonb as $$
declare
  game_row     public.games;
  player_count int;
  max_players  int;
  user_meta    jsonb;
  player_info  jsonb;
begin
  select * into game_row from public.games where id = game_id for update;

  if game_row is null then
    raise exception 'Game not found';
  end if;

  if game_row.phase != 'lobby' then
    raise exception 'Game is not accepting players';
  end if;

  if game_row.players ? (auth.uid()::text) then
    return game_row.players;
  end if;

  select count(*) into player_count
    from jsonb_object_keys(game_row.players);

  select coalesce(max(cardinality(m.powers)), 7) into max_players
    from public.maps m where m.id = game_row.map_id;

  if player_count >= max_players then
    raise exception 'Game is full';
  end if;

  select raw_user_meta_data into user_meta
    from auth.users where id = auth.uid();

  player_info = jsonb_build_object(
    'role', 'player',
    'display_name', public.user_display_name(user_meta),
    'joined_at', now()
  );

  update public.games
    set players = players || jsonb_build_object(auth.uid()::text, player_info)
    where id = game_id;

  return (select players from public.games where id = game_id);
end;
$$ language plpgsql security definer;

create or replace function public.claim_nation(p_game_id uuid, p_nation text)
returns void as $$
declare
  g   public.games;
  uid text;
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null then raise exception 'Game not found'; end if;
  if g.phase <> 'lobby' then raise exception 'Game has already started'; end if;

  uid := auth.uid()::text;
  if not (g.players ? uid) then raise exception 'You are not a player in this game'; end if;

  if p_nation is null then
    -- release the caller's current power
    update public.games
       set players = players #- array[uid, 'nation']
     where id = p_game_id;
    return;
  end if;

  -- reject if another player already holds this power
  if exists (
    select 1 from jsonb_each(g.players) e
    where e.key <> uid and e.value ->> 'nation' = p_nation
  ) then
    raise exception 'That power is already taken';
  end if;

  update public.games
     set players = jsonb_set(players, array[uid, 'nation'], to_jsonb(p_nation))
   where id = p_game_id;
end;
$$ language plpgsql security definer;

-- ── 4. settings shape ────────────────────────────────────────────────────────────
-- Absent, null, or a non-negative integer that fits an int.
create or replace function public.valid_minutes(v jsonb)
returns boolean as $$
  select v is null
      or jsonb_typeof(v) = 'null'
      or (jsonb_typeof(v) = 'number'
          and (v #>> '{}')::numeric >= 0
          and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
          and (v #>> '{}')::numeric <= 2147483647);
$$ language sql immutable;

-- Every key the SQL casts must have the type it is cast to; unknown keys pass. Minute
-- values are non-negative whole numbers (or null where "absent" has a meaning).
create or replace function public.valid_settings(s jsonb)
returns boolean as $$
  select s is null or (
    jsonb_typeof(s) = 'object'
    and coalesce(jsonb_typeof(s -> 'gunboat')          in ('boolean', 'null'), true)
    and coalesce(jsonb_typeof(s -> 'random_nations')   in ('boolean', 'null'), true)
    and coalesce(jsonb_typeof(s -> 'early_resolution') in ('boolean', 'null'), true)
    and coalesce(jsonb_typeof(s -> 'host_controls')    in ('boolean', 'null'), true)
    and public.valid_minutes(s -> 'grace_period')
    and public.valid_minutes(s -> 'first_turn')
    and coalesce(jsonb_typeof(s -> 'turn_timer') in ('string', 'null'), true)
    and (s -> 'phase_timers' is null
         or jsonb_typeof(s -> 'phase_timers') = 'null'
         or (jsonb_typeof(s -> 'phase_timers') = 'object'
             and not exists (select 1 from jsonb_each(s -> 'phase_timers') t
                              where not public.valid_minutes(t.value))))
  );
$$ language sql immutable;

-- The CHECK runs as the writing role, so the (pure) validators must be callable by it.
grant execute on function public.valid_minutes(jsonb), public.valid_settings(jsonb)
  to authenticated, service_role;

-- NOT VALID: enforced on every new write; existing rows are not re-checked here (a
-- bad legacy row would otherwise fail the migration). `validate constraint` later.
alter table public.games
  add constraint games_settings_valid check (public.valid_settings(settings)) not valid;

-- ── 5. commits check their claim ─────────────────────────────────────────────────
-- p_claim: the games.resolving_at the Edge Function read when it loaded the game. A
-- commit whose claim was reaped and re-fired (or already committed) raises instead of
-- landing twice. p_honoured: the nations whose orders were adjudicated; every other
-- unresolved row of the round is blanked. Both default null so a function deployed
-- before this migration keeps working (it then gets the old, unchecked behaviour).
drop function public.apply_resolution(uuid, jsonb, jsonb, jsonb, jsonb);
create function public.apply_resolution(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } just resolved
  p_snapshot   jsonb,
  p_next       jsonb,        -- { phase, season, year } to advance to
  p_ready_init jsonb default '{}',  -- nations auto-readied for the opening phase
  p_claim      timestamptz default null,
  p_honoured   text[] default null
)
returns void as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null then raise exception 'Game not found'; end if;
  if (g.year, g.season, g.phase)
     is distinct from ((p_round ->> 'year')::int, p_round ->> 'season', p_round ->> 'phase') then
    raise exception 'Stale resolution: the game is no longer at %', p_round;
  end if;
  if p_claim is not null and g.resolving_at is distinct from p_claim then
    raise exception 'Stale resolution: the claim was released or re-fired';
  end if;

  -- Unready nations held: blank their orders so the log matches the adjudication.
  update public.orders o
     set orders = '[]'::jsonb, updated_at = now()
   where o.game_id = p_game_id
     and o.year   = g.year
     and o.season = g.season
     and o.phase  = g.phase
     and o.resolved = false
     and case when p_honoured is null then not public.is_ready(g.ready, o.nation)
              else not (o.nation = any(p_honoured)) end;

  update public.orders
     set resolved = true, updated_at = now()
   where game_id = p_game_id
     and year   = g.year
     and season = g.season
     and phase  = g.phase
     and resolved = false;

  perform public.commit_board(p_game_id, p_snapshot, p_next, p_ready_init);
  perform public.settle_draw(p_game_id);
end;
$$ language plpgsql security definer;
grant execute on function public.apply_resolution(uuid, jsonb, jsonb, jsonb, jsonb, timestamptz, text[])
  to service_role;

drop function public.apply_revert(uuid, jsonb, jsonb, jsonb);
create function public.apply_revert(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } to reopen
  p_snapshot   jsonb,        -- the board going into that round
  p_ready_init jsonb default '{}',
  p_claim      timestamptz default null
)
returns void as $$
declare
  g      public.games;
  target integer := public.round_rank(
    (p_round ->> 'year')::int, p_round ->> 'season', p_round ->> 'phase');
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null then raise exception 'Game not found'; end if;
  if p_claim is not null and g.resolving_at is distinct from p_claim then
    raise exception 'Stale revert: the claim was released or re-fired';
  end if;

  delete from public.orders
   where game_id = p_game_id
     and public.round_rank(year, season, phase) > target;

  update public.orders
     set resolved = false, updated_at = now()
   where game_id = p_game_id
     and public.round_rank(year, season, phase) = target;

  delete from public.draw_votes where game_id = p_game_id;

  perform public.commit_board(p_game_id, p_snapshot, p_round, p_ready_init);
end;
$$ language plpgsql security definer;
grant execute on function public.apply_revert(uuid, jsonb, jsonb, jsonb, timestamptz)
  to service_role;

-- ── 6. set_deadline needs a deadline ─────────────────────────────────────────────
-- A null deadline with early resolution off would never resolve.
create or replace function public.set_deadline(p_game_id uuid, p_deadline timestamptz)
returns void as $$
declare g public.games;
begin
  if p_deadline is null then raise exception 'A deadline is required'; end if;
  g := public.lock_hosted_game(p_game_id);
  if not public.is_order_phase(g.phase) then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then
    raise exception 'Round is resolving; the deadline is locked';
  end if;
  update public.games set deadline = p_deadline where id = p_game_id;
end;
$$ language plpgsql security definer;

-- ── 7. pin search_path on every SECURITY DEFINER function ────────────────────────
-- Same resolution order the functions already ran with, minus anything the caller
-- could put ahead of it (pg_temp last). New definers must say `set search_path`
-- themselves — src/lib/__tests__/definerSearchPath.test.ts checks every migration
-- after this one.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', f);
  end loop;
end;
$$;
