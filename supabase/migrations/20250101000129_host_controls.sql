-- Host controls: an opt-in, creation-time admin menu for the host of a PRIVATE game.
--
-- `settings.host_controls` is set in the lobby and fixed once the game starts, so every
-- player can see before play begins whether the host can steer the game. It requires a
-- private game, and a host-controlled game cannot be made public.
--
-- With it on, the creator may, mid-game:
--   • override the current deadline            (set_deadline — previously any private game)
--   • change pacing settings                   (update_game_settings — previously any private game)
--   • force the current phase to resolve now   (host_force_resolve)
--   • revert the game to an earlier phase      (host_revert_to)
--
-- Both new actions go through the adjudicator Edge Function, which stays the sole
-- writer of the board: force-resolve is an ordinary resolution fired early, and a
-- revert is the Edge Function replaying the order log up to the target round and
-- committing that board via apply_revert.

-- ── Backfill ──────────────────────────────────────────────────────────────────
-- Existing private games already let their creator manage them; keep that.
update public.games
   set settings = settings || jsonb_build_object('host_controls', is_private)
 where not settings ? 'host_controls';

-- ── Immutability + privacy guard ──────────────────────────────────────────────
create or replace function public.guard_host_controls()
returns trigger as $$
declare
  hc boolean := coalesce((new.settings ->> 'host_controls')::boolean, false);
begin
  if tg_op = 'UPDATE' then
    if old.phase <> 'lobby'
       and hc is distinct from coalesce((old.settings ->> 'host_controls')::boolean, false) then
      raise exception 'Host controls are fixed once the game has started';
    end if;
  end if;
  if hc and not new.is_private then
    raise exception 'Games with host controls must stay private';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists games_guard_host_controls on public.games;
create trigger games_guard_host_controls
  before insert or update on public.games
  for each row
  execute function public.guard_host_controls();

-- ── Helpers ───────────────────────────────────────────────────────────────────

-- Chronological sort key for a round. Mirrors roundRank() in src/lib/adjudicator/fold.ts.
create or replace function public.round_rank(p_year integer, p_season text, p_phase text)
returns integer as $$
  select p_year * 100
       + case p_season when 'Fall' then 10 else 0 end
       + case p_phase when 'retreat' then 1 when 'build' then 2 else 0 end;
$$ language sql immutable;

-- Lock a game row and check the caller is its creator with host controls enabled.
create or replace function public.lock_hosted_game(p_game_id uuid)
returns public.games as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id for update;
  if g is null then raise exception 'Game not found'; end if;
  if g.created_by is distinct from auth.uid() then
    raise exception 'Only the game creator can do that';
  end if;
  if not coalesce((g.settings ->> 'host_controls')::boolean, false) then
    raise exception 'Host controls are not enabled for this game';
  end if;
  return g;
end;
$$ language plpgsql security definer;

-- Claim a game for the adjudicator and POST it a request. The caller has already
-- checked resolving_at is null under a row lock.
create or replace function public.fire_adjudicator(p_game_id uuid, p_body jsonb)
returns void as $$
declare cfg private.engine_config;
begin
  select * into cfg from private.engine_config where id;
  if cfg is null then raise exception 'The adjudicator is not configured'; end if;

  update public.games set resolving_at = now() where id = p_game_id;
  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || cfg.service_key),
    body    := jsonb_build_object('game_id', p_game_id) || coalesce(p_body, '{}'::jsonb)
  );
end;
$$ language plpgsql security definer;

-- ── set_deadline: gated on host_controls instead of is_private ─────────────────
create or replace function public.set_deadline(p_game_id uuid, p_deadline timestamptz)
returns void as $$
declare g public.games;
begin
  g := public.lock_hosted_game(p_game_id);
  if g.phase not in ('movement', 'retreat', 'build') then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then
    raise exception 'Round is resolving; the deadline is locked';
  end if;
  update public.games set deadline = p_deadline, updated_at = now() where id = p_game_id;
end;
$$ language plpgsql security definer;

-- ── update_game_settings: mid-game edits gated on host_controls ────────────────
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
       where k in ('phase_timers', 'early_resolution', 'allow_spectators'));
  end if;

  update public.games
     set settings = settings || patch,
         updated_at = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

-- ── Force the current phase to resolve now ─────────────────────────────────────
-- Exactly what the deadline backstop does, just immediately: unsubmitted nations hold.
create or replace function public.host_force_resolve(p_game_id uuid)
returns void as $$
declare g public.games;
begin
  g := public.lock_hosted_game(p_game_id);
  if g.phase not in ('movement', 'retreat', 'build') then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then raise exception 'Round is already resolving'; end if;
  perform public.fire_adjudicator(p_game_id, '{}'::jsonb);
end;
$$ language plpgsql security definer;

-- ── Revert to an earlier phase ─────────────────────────────────────────────────
-- Validates and claims the game; the Edge Function replays the log to the target
-- round and commits it through apply_revert. Allowed from a completed game too.
create or replace function public.host_revert_to(
  p_game_id uuid, p_year integer, p_season text, p_phase text)
returns void as $$
declare g public.games;
begin
  g := public.lock_hosted_game(p_game_id);
  if g.phase not in ('movement', 'retreat', 'build', 'complete') then
    raise exception 'Game has not started';
  end if;
  if g.resolving_at is not null then raise exception 'Round is resolving; try again shortly'; end if;
  if p_phase not in ('movement', 'retreat', 'build') or p_season not in ('Spring', 'Fall') then
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

-- Commit a revert (service role only — called by the Edge Function). Rounds after the
-- target are erased from the log; the target round's orders reopen as unsubmitted
-- drafts so players can amend rather than retype them.
create or replace function public.apply_revert(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } to reopen
  p_snapshot   jsonb,        -- the board going into that round
  p_deadline   timestamptz,
  p_ready_init jsonb default '{}'
)
returns void as $$
declare
  target integer := public.round_rank(
    (p_round ->> 'year')::int, p_round ->> 'season', p_round ->> 'phase');
begin
  delete from public.orders
   where game_id = p_game_id
     and public.round_rank(year, season, phase) > target;

  update public.orders
     set resolved = false, updated_at = now()
   where game_id = p_game_id
     and public.round_rank(year, season, phase) = target;

  update public.games
     set snapshot     = p_snapshot,
         phase        = p_round ->> 'phase',
         season       = p_round ->> 'season',
         year         = (p_round ->> 'year')::int,
         deadline     = p_deadline,
         ready        = coalesce(p_ready_init, '{}'::jsonb),
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

-- ── Grants ────────────────────────────────────────────────────────────────────
grant execute on function public.host_force_resolve(uuid)                    to authenticated;
grant execute on function public.host_revert_to(uuid, integer, text, text)   to authenticated;
grant execute on function public.apply_revert(uuid, jsonb, jsonb, timestamptz, jsonb) to service_role;
