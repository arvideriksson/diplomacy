-- Remove two leftovers.
--
-- settings.allow_spectators: a lobby / admin toggle that nothing ever read. Who can
-- see a game is decided only by the games select policy (is_private / creator /
-- player). Drop it from the column default, from existing rows, and from the
-- mid-game allowlist in update_game_settings.
--
-- is_current_round: used only by the orders insert/update policies, which
-- 20250101000128_lock_down_rpcs.sql dropped. Order writes go through the RPCs
-- (order_write_guard) now.

alter table public.games
  alter column settings set default '{
    "gunboat": false,
    "random_nations": false,
    "early_resolution": true,
    "phase_timers": { "movement": 1440, "retreat": 720, "build": 720 }
  }'::jsonb;

update public.games
   set settings = settings - 'allow_spectators'
 where settings ? 'allow_spectators';

-- update_game_settings (re-issues 134): allow_spectators leaves the mid-game allowlist.
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
       where k in ('phase_timers', 'early_resolution', 'grace_period'));
  end if;

  update public.games
     set settings = settings || patch,
         updated_at = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

drop function if exists public.is_current_round(uuid, integer, text, text);
