-- set_display_name (re-issues 139): its local `name` was ambiguous with games.name in
-- the roster update. Renamed to v_name.
create or replace function public.set_display_name(p_name text)
returns text as $$
declare
  uid    text := auth.uid()::text;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 32 then
    raise exception 'Name must be 2–32 characters';
  end if;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}') || jsonb_build_object('display_name', v_name)
   where id = auth.uid();

  -- Roster entries are objects; a private-game invite can still hold a bare 'pending'.
  update public.games
     set players = jsonb_set(players, array[uid, 'display_name'], to_jsonb(v_name))
   where players ? uid
     and jsonb_typeof(players -> uid) = 'object';

  return v_name;
end;
$$ language plpgsql security definer;
