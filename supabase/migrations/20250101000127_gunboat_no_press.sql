-- Gunboat: a no-press variant. When settings.gunboat is true there is no chat at
-- all — no public channel is auto-created, and the channel-creation RPCs refuse.
-- The map a game is played on is now chosen via map_id (Classical / 1900), so the
-- old settings.variant ('standard' | 'gunboat') is retired in favor of a dedicated
-- boolean. Existing rows keep working: a missing gunboat key reads as false.

-- ── New default for freshly-created games ────────────────────────────────────
alter table public.games
  alter column settings set default '{
    "gunboat": false,
    "allow_spectators": true,
    "random_nations": false,
    "early_resolution": true,
    "phase_timers": { "movement": 1440, "retreat": 720, "build": 720 }
  }'::jsonb;

-- Migrate the legacy enum: any game that was set to "gunboat" becomes gunboat=true.
update public.games
   set settings = (settings - 'variant') || jsonb_build_object(
         'gunboat', coalesce(settings ->> 'variant', '') = 'gunboat')
 where settings ? 'variant';

-- ── helper: is this game press-free? ─────────────────────────────────────────
create or replace function public.is_gunboat(p_game_id uuid)
returns boolean as $$
  select coalesce((settings ->> 'gunboat')::boolean, false)
    from public.games where id = p_game_id;
$$ language sql security definer stable;

-- ── Skip the auto public press channel in gunboat games ──────────────────────
create or replace function public.create_public_channel()
returns trigger as $$
declare nations text[];
begin
  if coalesce((new.settings ->> 'gunboat')::boolean, false) then
    return new;  -- gunboat: no press, no public channel
  end if;

  select array_agg(distinct value ->> 'nation' order by value ->> 'nation')
    into nations
    from jsonb_each(new.players)
    where value ->> 'nation' is not null;

  if coalesce(array_length(nations, 1), 0) >= 1 then
    insert into public.chat_channels (game_id, members, is_public)
    values (new.id, nations, true)
    on conflict (game_id, members) where name is null do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- ── Refuse channel creation in gunboat games ─────────────────────────────────
create or replace function public.get_or_create_channel(
  p_game_id uuid,
  p_members text[]
) returns public.chat_channels as $$
declare
  me            text;
  canonical     text[];
  valid_nations text[];
  ch            public.chat_channels;
begin
  if public.is_gunboat(p_game_id) then
    raise exception 'Press is disabled in this game (gunboat)';
  end if;

  me := public.current_nation(p_game_id);
  if me is null then raise exception 'You are not a player in this game'; end if;

  -- canonical = sorted + deduped + always includes the caller
  select array_agg(distinct n order by n)
    into canonical
    from unnest(p_members || array[me]) as n
    where n is not null;

  if coalesce(array_length(canonical, 1), 0) < 2 then
    raise exception 'A conversation needs at least two members';
  end if;

  select array_agg(distinct value ->> 'nation')
    into valid_nations
    from public.games g, jsonb_each(g.players)
    where g.id = p_game_id and value ->> 'nation' is not null;

  if not (canonical <@ valid_nations) then
    raise exception 'All members must be nations in this game';
  end if;

  insert into public.chat_channels (game_id, members, is_public)
  values (p_game_id, canonical, false)
  on conflict (game_id, members) where name is null do nothing;

  select * into ch from public.chat_channels
   where game_id = p_game_id and members = canonical and name is null;

  return ch;
end;
$$ language plpgsql security definer;

create or replace function public.create_named_channel(
  p_game_id uuid,
  p_members text[],
  p_name    text
) returns public.chat_channels as $$
declare
  me            text;
  canonical     text[];
  valid_nations text[];
  ch            public.chat_channels;
begin
  if public.is_gunboat(p_game_id) then
    raise exception 'Press is disabled in this game (gunboat)';
  end if;

  me := public.current_nation(p_game_id);
  if me is null then raise exception 'You are not a player in this game'; end if;

  if p_name is null or length(trim(p_name)) = 0 then raise exception 'A name is required'; end if;
  if length(p_name) > 60 then raise exception 'Name too long (max 60 characters)'; end if;

  select array_agg(distinct n order by n)
    into canonical
    from unnest(p_members || array[me]) as n
    where n is not null;

  if coalesce(array_length(canonical, 1), 0) < 2 then
    raise exception 'A conversation needs at least two members';
  end if;

  select array_agg(distinct value ->> 'nation')
    into valid_nations
    from public.games g, jsonb_each(g.players)
    where g.id = p_game_id and value ->> 'nation' is not null;

  if not (canonical <@ valid_nations) then
    raise exception 'All members must be nations in this game';
  end if;

  insert into public.chat_channels (game_id, members, is_public, name)
  values (p_game_id, canonical, false, trim(p_name))
  returning * into ch;

  return ch;
end;
$$ language plpgsql security definer;
