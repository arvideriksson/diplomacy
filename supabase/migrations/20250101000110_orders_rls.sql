-- Order secrecy + write rules. The `resolved` flag is the simultaneous-reveal
-- gate: a nation's orders are private until their round is adjudicated.

-- The nation the calling user controls in a game (from games.players).
create or replace function public.current_nation(p_game_id uuid)
returns text as $$
  select g.players -> (auth.uid()::text) ->> 'nation'
  from public.games g
  where g.id = p_game_id;
$$ language sql security definer stable;

-- Is (year, season, phase) the game's current round?
create or replace function public.is_current_round(
  p_game_id uuid, p_year integer, p_season text, p_phase text)
returns boolean as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game_id
      and g.year = p_year
      and g.season = p_season
      and g.phase = p_phase
  );
$$ language sql security definer stable;

-- Drop-then-create so the file is safely re-runnable (no `create policy if not exists`).
drop policy if exists "orders_select_own_or_resolved" on public.orders;
drop policy if exists "orders_insert_own_current_unresolved" on public.orders;
drop policy if exists "orders_update_own_current_unresolved" on public.orders;

-- SELECT: your own orders always; other nations' orders only once resolved.
create policy "orders_select_own_or_resolved"
  on public.orders for select
  to authenticated
  using (
    resolved = true
    or nation = public.current_nation(game_id)
  );

-- INSERT/UPDATE: own nation, current round, not yet resolved. (The submit RPC is
-- the supported path; these policies are a defensive backstop for direct writes.)
create policy "orders_insert_own_current_unresolved"
  on public.orders for insert
  to authenticated
  with check (
    nation = public.current_nation(game_id)
    and resolved = false
    and public.is_current_round(game_id, year, season, phase)
  );

create policy "orders_update_own_current_unresolved"
  on public.orders for update
  to authenticated
  using (
    nation = public.current_nation(game_id)
    and resolved = false
    and public.is_current_round(game_id, year, season, phase)
  )
  with check (
    nation = public.current_nation(game_id)
    and resolved = false
  );

-- No DELETE policy: rounds are immutable history.
