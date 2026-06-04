-- Client write path + the atomic resolution commit used by the Edge Function.

-- Upsert the caller's own-nation orders for the current unresolved round and set
-- the ready flag. Editing orders un-readies the nation unless it readies in the
-- same call. Derives the nation server-side; never touches a resolved row.
create or replace function public.submit_orders(
  p_game_id uuid,
  p_orders  jsonb,
  p_ready   boolean default false
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

-- Toggle ready without resubmitting orders.
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
end;
$$ language plpgsql security definer;

-- Atomically commit one resolution: freeze+reveal the round's orders, write the
-- new snapshot/units, advance the cursor, reset ready, and clear the lock. Called
-- only by the adjudicator Edge Function (service role). Single transaction so a
-- crash mid-write can never leave a half-advanced game.
create or replace function public.apply_resolution(
  p_game_id  uuid,
  p_round    jsonb,        -- { year, season, phase } just resolved
  p_snapshot jsonb,
  p_units    jsonb,
  p_next     jsonb,        -- { phase, season, year } to advance to
  p_deadline timestamptz
)
returns void as $$
begin
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
         ready        = '{}'::jsonb,
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;
