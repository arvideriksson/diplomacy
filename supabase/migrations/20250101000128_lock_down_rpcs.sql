-- Lock down the client-reachable surface.
--
-- 1. EXECUTE is whitelisted. Postgres grants EXECUTE on new functions to PUBLIC, and
--    Supabase's default privileges grant it to anon/authenticated too, so every
--    function here — including the service-only apply_resolution — was callable
--    through PostgREST by anyone holding the public anon key. Revoke everything, then
--    grant back only the RPCs the client calls plus the helpers RLS policies evaluate
--    as the querying user. Default privileges change too, so a FUTURE function is
--    private until its migration grants it explicitly.
-- 2. games UPDATE is narrowed. The creator could previously update any column of
--    their game directly — rewrite the snapshot, flip ready flags, or assign
--    themselves another nation (and so read that nation's sealed orders and chats).
--    Direct updates are now limited to name / is_private / map_id / settings, and the
--    latter three only in the lobby. Starting a game moves to the start_game RPC.
-- 3. games INSERT must create a lobby game containing only its creator.
-- 4. orders has no direct client writes; save_draft_orders / submit_orders are the
--    only write path (they enforce the ready and resolving-lock guards RLS can't).

-- ── 1. function EXECUTE whitelist ───────────────────────────────────────────────

revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- RLS helpers (evaluated by policies on games/orders/chat and realtime.messages).
grant execute on function public.current_nation(uuid)  to authenticated;
grant execute on function public.chat_member_of(bigint) to authenticated;

-- Lobby / game management.
grant execute on function public.join_public_game(uuid)                     to authenticated;
grant execute on function public.leave_game(uuid)                           to authenticated;
grant execute on function public.kick_player(uuid, uuid)                    to authenticated;
grant execute on function public.claim_nation(uuid, text)                   to authenticated;
grant execute on function public.update_game_settings(uuid, jsonb)          to authenticated;
grant execute on function public.set_deadline(uuid, timestamptz)            to authenticated;
grant execute on function public.admin_delete_all_games()                   to authenticated;

-- Orders.
grant execute on function public.save_draft_orders(uuid, jsonb, integer, text, text)       to authenticated;
grant execute on function public.submit_orders(uuid, jsonb, boolean, integer, text, text)  to authenticated;

-- Chat.
grant execute on function public.get_or_create_channel(uuid, text[])        to authenticated;
grant execute on function public.create_named_channel(uuid, text[], text)   to authenticated;
grant execute on function public.rename_channel(bigint, text)               to authenticated;
grant execute on function public.send_chat_message(bigint, text)            to authenticated;
grant execute on function public.mark_chat_read(bigint)                     to authenticated;
grant execute on function public.upsert_chat_draft(uuid, text[], text, text) to authenticated;
grant execute on function public.rename_chat_draft(bigint, text)            to authenticated;
grant execute on function public.delete_chat_draft(bigint)                  to authenticated;

-- The adjudicator Edge Function (service role) commits resolutions.
grant execute on function public.apply_resolution(uuid, jsonb, jsonb, jsonb, timestamptz, jsonb)
  to service_role;

-- ── 2. start_game + narrowed games UPDATE ────────────────────────────────────────

-- Move a lobby game into Spring movement: assign nations, stamp the opening round and
-- first deadline. Mirrors the old client-side startGame. Players keep the power they
-- claimed (unless random_nations); the rest are dealt the free powers at random. The
-- snapshot stays null — both the adjudicator and the client read a null snapshot as
-- the map's opening position (see 122_drop_games_units.sql).
--
-- The power lists duplicate src/lib/maps/*: a new map must be added here as well.
create or replace function public.start_game(p_game_id uuid)
returns void as $$
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
  select * into g from public.games where id = p_game_id for update;
  if g is null then raise exception 'Game not found'; end if;
  if g.created_by <> auth.uid() then
    raise exception 'Only the game creator can start the game';
  end if;
  if g.phase <> 'lobby' then raise exception 'Game has already started'; end if;

  powers := case g.map_id
    when 'classical' then array['england', 'france', 'germany', 'italy', 'austria', 'russia', 'turkey']
    when '1900'      then array['britain', 'france', 'germany', 'italy', 'austria', 'russia', 'turkey']
  end;
  start_year := case g.map_id when '1900' then 1900 else 1901 end;
  if powers is null then raise exception 'Unknown map: %', g.map_id; end if;

  if (select count(*) from jsonb_object_keys(g.players)) > array_length(powers, 1) then
    raise exception 'Too many players for this map (max %)', array_length(powers, 1);
  end if;

  random_mode := coalesce((g.settings ->> 'random_nations')::boolean, false);

  -- Powers nobody validly claimed, shuffled.
  select coalesce(array_agg(pw order by random()), '{}') into free
    from unnest(powers) pw
   where random_mode
      or not exists (
           select 1 from jsonb_each(g.players) e where e.value ->> 'nation' = pw);

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
         deadline     = now() + make_interval(
                          mins => coalesce((g.settings -> 'phase_timers' ->> 'movement')::int, 1440)),
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

grant execute on function public.start_game(uuid) to authenticated;

drop policy if exists "Game creator can update" on public.games;
create policy "Game creator can update"
  on public.games for update
  to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

revoke update on public.games from anon, authenticated;
grant update (name, is_private, map_id, settings) on public.games to authenticated;

-- Privacy, map and settings are fixed once a game starts for direct (client) writes.
-- Mid-game setting changes go through update_game_settings, which runs as the
-- function owner and so isn't caught here.
create or replace function public.guard_client_game_update()
returns trigger as $$
begin
  if current_user in ('anon', 'authenticated')
     and old.phase <> 'lobby'
     and (new.is_private, new.map_id, new.settings)
         is distinct from (old.is_private, old.map_id, old.settings) then
    raise exception 'Privacy, map and settings are locked once the game has started';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists games_guard_client_update on public.games;
create trigger games_guard_client_update
  before update on public.games
  for each row
  execute function public.guard_client_game_update();

-- ── 3. games INSERT: a fresh lobby holding only its creator ───────────────────────

drop policy if exists "Users can create games" on public.games;
create policy "Users can create games"
  on public.games for insert
  to authenticated
  with check (
    auth.uid() = created_by
    and phase = 'lobby'
    and players ? (auth.uid()::text)
    and (select count(*) from jsonb_object_keys(players)) = 1
  );

revoke insert on public.games from anon, authenticated;
grant insert (name, phase, year, season, map_id, players, settings, is_private, created_by)
  on public.games to authenticated;

-- ── 4. orders: RPC-only writes ───────────────────────────────────────────────────

drop policy if exists "orders_insert_own_current_unresolved" on public.orders;
drop policy if exists "orders_update_own_current_unresolved" on public.orders;
revoke insert, update, delete on public.orders from anon, authenticated;
