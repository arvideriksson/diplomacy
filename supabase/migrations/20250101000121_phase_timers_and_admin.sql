-- Per-phase turn timers + early-resolution flag + creator/admin in-game controls.
--
-- Replaces the single `settings.turn_timer` enum with structured per-phase
-- durations (minutes) and an `early_resolution` toggle, and adds two guarded RPCs
-- the game creator uses to manage a running game: override the deadline (private
-- games only) and edit the mutable subset of settings.

-- ── Backfill existing rows ───────────────────────────────────────────────────
-- Preserve current pacing: movement keeps the legacy timer; the shorter phases
-- default to half that (floor 12h). early_resolution defaults on (current behavior).
update public.games g
   set settings = settings
     || jsonb_build_object(
          'early_resolution',
          coalesce((settings ->> 'early_resolution')::boolean, true))
     || case
          when settings ? 'phase_timers' then '{}'::jsonb
          else jsonb_build_object(
                 'phase_timers',
                 jsonb_build_object(
                   'movement', mv.minutes,
                   'retreat',  greatest(720, mv.minutes / 2),
                   'build',    greatest(720, mv.minutes / 2)))
        end
  from (
    select id,
           case settings ->> 'turn_timer'
             when '12h' then 720
             when '24h' then 1440
             when '48h' then 2880
             when '72h' then 4320
             when '1w'  then 10080
             else 1440
           end as minutes
      from public.games
  ) mv
 where g.id = mv.id;

-- ── New default for freshly-created games ────────────────────────────────────
alter table public.games
  alter column settings set default '{
    "variant": "standard",
    "allow_spectators": true,
    "random_nations": false,
    "early_resolution": true,
    "phase_timers": { "movement": 1440, "retreat": 720, "build": 720 }
  }'::jsonb;

-- ── Deadline override (creator, private games only) ──────────────────────────
-- The creator of a PRIVATE game may move the current phase's deadline to any time.
-- Public games keep their host hands-off so play stays fair.
create or replace function public.set_deadline(p_game_id uuid, p_deadline timestamptz)
returns void as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;
  if g.created_by <> auth.uid() then
    raise exception 'Only the game creator can change the deadline';
  end if;
  if not g.is_private then
    raise exception 'The deadline can only be overridden in private games';
  end if;
  if g.phase not in ('movement', 'retreat', 'build') then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then
    raise exception 'Round is resolving; the deadline is locked';
  end if;
  update public.games set deadline = p_deadline, updated_at = now() where id = p_game_id;
end;
$$ language plpgsql security definer;

-- ── Settings update (creator) ────────────────────────────────────────────────
-- Merges into existing settings. In the lobby the creator may change anything; once
-- the game has started only the pacing-related keys are mutable (and only in private
-- games) — variant / random_nations are fixed for the life of a started game.
create or replace function public.update_game_settings(p_game_id uuid, p_settings jsonb)
returns void as $$
declare
  g       public.games;
  patch   jsonb;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;
  if g.created_by <> auth.uid() then
    raise exception 'Only the game creator can change settings';
  end if;

  if g.phase = 'lobby' then
    patch := coalesce(p_settings, '{}'::jsonb);
  else
    if not g.is_private then
      raise exception 'Settings are locked for public games once started';
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
