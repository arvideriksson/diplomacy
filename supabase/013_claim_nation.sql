-- Lobby power selection. Players claim a power atomically so two players can never
-- hold the same one. Pass null to release. Lobby phase only; security definer so it
-- can mutate games.players (which players otherwise can't update directly).

create or replace function public.claim_nation(p_game_id uuid, p_nation text)
returns void as $$
declare
  g   public.games;
  uid text;
begin
  select * into g from public.games where id = p_game_id;
  if g is null then raise exception 'Game not found'; end if;
  if g.phase <> 'lobby' then raise exception 'Game has already started'; end if;

  uid := auth.uid()::text;
  if not (g.players ? uid) then raise exception 'You are not a player in this game'; end if;

  if p_nation is null then
    -- release the caller's current power
    update public.games
       set players = players #- array[uid, 'nation'], updated_at = now()
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
     set players = jsonb_set(players, array[uid, 'nation'], to_jsonb(p_nation)),
         updated_at = now()
   where id = p_game_id;
end;
$$ language plpgsql security definer;
