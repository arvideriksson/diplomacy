-- Instant early resolution + auto-ready idle nations.
--
-- Early resolution previously relied on the once-a-minute cron noticing all_powers_ready
-- — up to ~60s after the last submit. This fires the adjudicator the moment the last
-- ready flag lands, gated on the game's early_resolution setting (default on). The cron
-- stays as the deadline backstop and a catch-all.
--
-- Auto-ready: apply_resolution now seeds games.ready for the opening phase (the Edge
-- Function passes the nations with nothing to do — see idleNations), so a build/retreat
-- phase resolves as soon as the few nations that actually act submit, instead of waiting
-- on everyone.

-- ── instant trigger ──────────────────────────────────────────────────────────

-- Claim a game and fire the adjudicator now, if it's all-ready and early resolution is
-- enabled. Mirrors tick_due_games' firing path; safe to call from the submit RPC.
create or replace function public.maybe_resolve_now(p_game_id uuid)
returns void as $$
declare cfg private.engine_config; g public.games;
begin
  select * into g from public.games where id = p_game_id;
  if g is null or g.resolving_at is not null then return; end if;
  if g.phase not in ('movement', 'retreat', 'build') then return; end if;
  if not coalesce((g.settings->>'early_resolution')::boolean, true) then return; end if;
  if not public.all_powers_ready(p_game_id) then return; end if;

  select * into cfg from private.engine_config where id;
  if cfg is null then return; end if;

  update public.games set resolving_at = now() where id = p_game_id and resolving_at is null;
  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || cfg.service_key),
    body    := jsonb_build_object('game_id', p_game_id)
  );
end;
$$ language plpgsql security definer;

-- ── submit_orders: round-guard (118) + fire early resolution when all ready ──────

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

  -- Last power in? Resolve immediately rather than waiting for the cron tick.
  if p_ready then perform public.maybe_resolve_now(p_game_id); end if;
end;
$$ language plpgsql security definer;

-- set_ready can also complete the set (e.g. a nation toggling ready) — fire there too.
create or replace function public.set_ready(p_game_id uuid, p_ready boolean)
returns void as $$
declare g public.games; my_nation text;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;
  my_nation := g.players -> (auth.uid()::text) ->> 'nation';
  if my_nation is null then raise exception 'Not a player in this game'; end if;
  if g.resolving_at is not null then raise exception 'Round is resolving'; end if;
  update public.games
     set ready = case when p_ready then ready || jsonb_build_object(my_nation, true)
                      else ready - my_nation end,
         updated_at = now()
   where id = p_game_id;
  if p_ready then perform public.maybe_resolve_now(p_game_id); end if;
end;
$$ language plpgsql security definer;

-- ── apply_resolution: seed the opening phase's auto-ready set (117 body + p_ready_init) ──

create or replace function public.apply_resolution(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } just resolved
  p_snapshot   jsonb,
  p_units      jsonb,
  p_next       jsonb,        -- { phase, season, year } to advance to
  p_deadline   timestamptz,
  p_ready_init jsonb default '{}'  -- nations auto-readied for the opening phase
)
returns void as $$
begin
  -- Unready nations held: blank their orders so the log matches the adjudication.
  update public.orders o
     set orders = '[]'::jsonb, updated_at = now()
    from public.games g
   where g.id = p_game_id
     and o.game_id = p_game_id
     and o.year   = (p_round->>'year')::int
     and o.season =  p_round->>'season'
     and o.phase  =  p_round->>'phase'
     and o.resolved = false
     and not coalesce((g.ready ->> o.nation)::boolean, false);

  update public.orders
     set resolved = true, updated_at = now()
   where game_id = p_game_id
     and year   = (p_round->>'year')::int
     and season =  p_round->>'season'
     and phase  =  p_round->>'phase'
     and resolved = false;

  update public.games
     set snapshot     = p_snapshot,
         units        = p_units,
         phase        = p_next->>'phase',
         season       = p_next->>'season',
         year         = (p_next->>'year')::int,
         deadline     = p_deadline,
         ready        = coalesce(p_ready_init, '{}'::jsonb),
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;

-- ── cron: only honor the all-ready trigger when early resolution is enabled ──────

create or replace function public.tick_due_games()
returns void as $$
declare
  cfg private.engine_config;
  g   record;
begin
  update public.games
     set resolving_at = null
   where resolving_at is not null
     and resolving_at < now() - interval '5 minutes';

  select * into cfg from private.engine_config where id;
  if cfg is null then return; end if;

  for g in
    select id
      from public.games
     where phase in ('movement', 'retreat', 'build')
       and resolving_at is null
       and (
             (deadline is not null and deadline <= now())
          or (coalesce((settings->>'early_resolution')::boolean, true)
              and public.all_powers_ready(id))
           )
     for update skip locked
  loop
    update public.games set resolving_at = now() where id = g.id;
    perform net.http_post(
      url     := cfg.function_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || cfg.service_key),
      body    := jsonb_build_object('game_id', g.id)
    );
  end loop;
end;
$$ language plpgsql security definer;
