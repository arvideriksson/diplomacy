-- Ending a game by agreement: ties and concessions.
--
-- Each surviving power holds one secret vote:
--   * Solo (the default, no row): play on for the win — equivalent to "a tie of just me".
--   * A tie: the set of powers that share the result (always including the voter).
--   * Concede (members is null): accept any result that doesn't include me.
--
-- The game ends the moment some set S of surviving powers agrees: every survivor in S
-- votes for exactly S, and every survivor outside S concedes. Eliminated powers (no
-- units, no supply centers) count as conceded, and are dropped from the tie sets that
-- name them. |S| = 1 is a win by concession; larger S is an S-way tie.
--
-- Votes are secret until the game is over: a player reads only their own vote (RLS),
-- the table is not in the realtime publication, and the outcome is the only thing
-- revealed while the game runs — so a player can claim a vote they never cast.
--
-- settle_draw() ends the game; it changes no board, only stamps phase 'complete' and
-- games.result. It runs after every vote change (set_draw_vote) and after every
-- resolution (apply_resolution — an elimination can complete an agreement), and never
-- while a resolution is in flight. A revert clears the votes and the result.

alter table public.games add column if not exists result jsonb;
comment on column public.games.result is
  'How a game ended by agreement: { kind: draw|concession, nations: [...], year, season, phase }. '
  'Null for a solo by supply centers (derived from the snapshot) and for running games.';

create table if not exists public.draw_votes (
  game_id    uuid        not null references public.games(id) on delete cascade,
  nation     text        not null,
  -- The powers sharing the result (sorted, includes `nation`); null = concede.
  members    text[],
  updated_at timestamptz not null default now(),
  primary key (game_id, nation)
);

alter table public.draw_votes enable row level security;

-- Own vote only while the game runs; every player's once it is over. No client writes:
-- set_draw_vote is the only path in.
drop policy if exists "draw_votes_select" on public.draw_votes;
create policy "draw_votes_select"
  on public.draw_votes for select to authenticated
  using (
    nation = public.current_nation(game_id)
    or (public.current_nation(game_id) is not null
        and exists (select 1 from public.games g where g.id = game_id and g.phase = 'complete'))
  );
revoke insert, update, delete on public.draw_votes from anon, authenticated;

-- ── Survivors ─────────────────────────────────────────────────────────────────
-- Assigned nations still on the board (a unit or a supply center). Before the first
-- resolution (no snapshot) everyone is alive.
create or replace function public.surviving_nations(g public.games)
returns text[] as $$
  select coalesce(array_agg(n order by n), '{}')
    from unnest(coalesce(public.game_nations(g.players), '{}')) as n
   where g.snapshot is null
      or exists (select 1 from jsonb_array_elements(coalesce(g.snapshot -> 'units', '[]')) u
                  where u ->> 'nation' = n)
      or exists (select 1 from jsonb_each_text(coalesce(g.snapshot -> 'supplyCenters', '{}')) s
                  where s.value = n);
$$ language sql stable;

-- A survivor's effective vote: null = concede; otherwise its tie set restricted to the
-- survivors (sorted). No row = solo = {nation}.
create or replace function public.draw_vote_set(p_game_id uuid, p_nation text, p_alive text[])
returns text[] as $$
declare
  v public.draw_votes;
begin
  select * into v from public.draw_votes where game_id = p_game_id and nation = p_nation;
  if not found then return array[p_nation]; end if;
  if v.members is null then return null; end if;
  return (select array_agg(m order by m) from unnest(v.members) m where m = any(p_alive));
end;
$$ language plpgsql stable;

-- The set the survivors have agreed on, or null.
create or replace function public.draw_outcome(g public.games)
returns text[] as $$
declare
  alive text[] := public.surviving_nations(g);
  n     text;
  m     text;
  cand  text[];
  ok    boolean;
begin
  if cardinality(alive) = 0 then return null; end if;
  foreach n in array alive loop
    cand := public.draw_vote_set(g.id, n, alive);
    continue when cand is null;
    ok := true;
    foreach m in array alive loop
      if m = any(cand) then
        ok := public.draw_vote_set(g.id, m, alive) is not distinct from cand;
      else
        ok := public.draw_vote_set(g.id, m, alive) is null;
      end if;
      exit when not ok;
    end loop;
    if ok then return cand; end if;
  end loop;
  return null;
end;
$$ language plpgsql stable;

-- End the game if the survivors have agreed. Service-only (no grant): called from
-- set_draw_vote and apply_resolution. Returns whether the game ended.
create or replace function public.settle_draw(p_game_id uuid)
returns boolean as $$
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
                        'phase',   g.phase),
         updated_at = now()
   where id = p_game_id;
  return true;
end;
$$ language plpgsql security definer;

-- ── set_draw_vote ─────────────────────────────────────────────────────────────
-- Record the caller's vote: p_concede, or the powers to share a tie with (the caller
-- is added; an empty or self-only set means solo). Returns whether the game ended.
create or replace function public.set_draw_vote(
  p_game_id uuid,
  p_members text[]  default null,
  p_concede boolean default false
)
returns boolean as $$
declare
  g         public.games;
  my_nation text;
  alive     text[];
  members   text[];
begin
  select * into g from public.games where id = p_game_id;
  if not found then raise exception 'Game not found'; end if;
  my_nation := public.player_nation(g.players);
  if my_nation is null then raise exception 'Only players can vote'; end if;
  if not public.is_order_phase(g.phase) then raise exception 'The game is not running'; end if;
  alive := public.surviving_nations(g);
  if not my_nation = any(alive) then raise exception 'Eliminated powers no longer vote'; end if;

  if p_concede then
    members := null;
  else
    members := (select array_agg(distinct m order by m)
                  from unnest(coalesce(p_members, '{}') || array[my_nation]) m);
    if exists (select 1 from unnest(members) m where not m = any(alive)) then
      raise exception 'A tie can only include powers still in the game';
    end if;
  end if;

  if not p_concede and members = array[my_nation] then
    delete from public.draw_votes where game_id = p_game_id and nation = my_nation;  -- solo
  else
    insert into public.draw_votes (game_id, nation, members, updated_at)
    values (p_game_id, my_nation, members, now())
    on conflict (game_id, nation) do update set members = excluded.members, updated_at = now();
  end if;

  return public.settle_draw(p_game_id);
end;
$$ language plpgsql security definer;

grant execute on function public.set_draw_vote(uuid, text[], boolean) to authenticated;

-- ── commit_board (re-issues 136): a committed board clears any agreed result ──
create or replace function public.commit_board(
  p_game_id    uuid,
  p_snapshot   jsonb,
  p_round      jsonb,
  p_ready_init jsonb
)
returns void as $$
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
         resolving_at = null,
         updated_at   = now()
   where id = p_game_id;
end;
$$ language plpgsql;

-- ── apply_resolution (re-issues 136): settle agreements an elimination completes ──
create or replace function public.apply_resolution(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } just resolved
  p_snapshot   jsonb,
  p_next       jsonb,        -- { phase, season, year } to advance to
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
     and not public.is_ready(g.ready, o.nation);

  update public.orders
     set resolved = true, updated_at = now()
   where game_id = p_game_id
     and year   = (p_round->>'year')::int
     and season =  p_round->>'season'
     and phase  =  p_round->>'phase'
     and resolved = false;

  perform public.commit_board(p_game_id, p_snapshot, p_next, p_ready_init);
  perform public.settle_draw(p_game_id);
end;
$$ language plpgsql security definer;

-- ── apply_revert (re-issues 136): a reverted game starts its votes over ─────────
create or replace function public.apply_revert(
  p_game_id    uuid,
  p_round      jsonb,        -- { year, season, phase } to reopen
  p_snapshot   jsonb,        -- the board going into that round
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

  delete from public.draw_votes where game_id = p_game_id;

  perform public.commit_board(p_game_id, p_snapshot, p_round, p_ready_init);
end;
$$ language plpgsql security definer;
