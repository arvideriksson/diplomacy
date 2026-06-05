-- Stale-write guard. save_draft_orders and submit_orders derived the target round from
-- the game's CURRENT (year, season, phase). An order write in flight when the round
-- resolves therefore landed in the NEW round's row — e.g. a movement-phase autosave
-- arriving just after the phase advanced wrote Move orders into the BUILD row. The
-- client-side debounce timer is cancelled on phase change, but an already-sent RPC can't
-- be recalled.
--
-- Fix: the caller stamps the round it was editing (p_year, p_season, p_phase); the RPC
-- writes only if that's still the current round. A stale autosave becomes a silent
-- no-op; a stale submit raises so the client reloads. Round params default to null
-- (guard skipped) for backward compatibility.

drop function if exists public.save_draft_orders(uuid, jsonb);
drop function if exists public.submit_orders(uuid, jsonb, boolean);

-- Autosave the caller's unsubmitted draft into their single orders row, only if the
-- stamped round is still current (else a no-op — the round moved on). Never touches
-- games.ready, so it stays a draft and is never broadcast.
create or replace function public.save_draft_orders(
  p_game_id uuid,
  p_orders  jsonb,
  p_year    integer default null,
  p_season  text    default null,
  p_phase   text    default null
)
returns void as $$
declare g public.games; me text;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;
  me := g.players -> (auth.uid()::text) ->> 'nation';
  if me is null then raise exception 'You are not a player with a nation in this game'; end if;
  if g.phase not in ('movement', 'retreat', 'build') then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then raise exception 'Round is resolving; orders are locked'; end if;

  -- Stale write (the round advanced under an in-flight autosave): drop it silently.
  if p_year is not null
     and (g.year, g.season, g.phase) is distinct from (p_year, p_season, p_phase) then
    return;
  end if;

  -- Already submitted? Drafts are inert once ready — refuse so an autosave can never
  -- silently overwrite the committed set. Re-submission goes through submit_orders.
  if coalesce((g.ready ->> me)::boolean, false) then return; end if;

  insert into public.orders (game_id, year, season, phase, nation, orders, submitted_by, resolved)
  values (p_game_id, g.year, g.season, g.phase, me, coalesce(p_orders, '[]'::jsonb), auth.uid(), false)
  on conflict (game_id, year, season, phase, nation)
  do update set orders = excluded.orders, submitted_by = excluded.submitted_by, updated_at = now()
  where public.orders.resolved = false;
end;
$$ language plpgsql security definer;

-- Upsert the caller's own-nation orders for the current round and set ready, only if the
-- stamped round is still current (else raise — the round resolved while submitting).
create or replace function public.submit_orders(
  p_game_id uuid,
  p_orders  jsonb,
  p_ready   boolean default false,
  p_year    integer default null,
  p_season  text    default null,
  p_phase   text    default null
)
returns void as $$
declare
  g         public.games;
  my_nation text;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;

  my_nation := g.players -> (auth.uid()::text) ->> 'nation';
  if my_nation is null then
    raise exception 'You are not a player with a nation in this game';
  end if;
  if g.phase not in ('movement', 'retreat', 'build') then
    raise exception 'Game is not in an order-taking phase';
  end if;
  if g.resolving_at is not null then
    raise exception 'Round is resolving; orders are locked';
  end if;
  if p_year is not null
     and (g.year, g.season, g.phase) is distinct from (p_year, p_season, p_phase) then
    raise exception 'Round has advanced; reload before submitting';
  end if;

  insert into public.orders (game_id, year, season, phase, nation, orders, submitted_by, resolved)
  values (p_game_id, g.year, g.season, g.phase, my_nation, coalesce(p_orders, '[]'::jsonb), auth.uid(), false)
  on conflict (game_id, year, season, phase, nation)
  do update set orders = excluded.orders, submitted_by = excluded.submitted_by, updated_at = now()
  where public.orders.resolved = false;

  update public.games
     set ready = case when p_ready then ready || jsonb_build_object(my_nation, true)
                      else ready - my_nation end,
         updated_at = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

grant execute on function public.save_draft_orders(uuid, jsonb, integer, text, text) to authenticated;
grant execute on function public.submit_orders(uuid, jsonb, boolean, integer, text, text) to authenticated;
