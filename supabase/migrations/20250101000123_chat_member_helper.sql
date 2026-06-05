-- Extract the duplicated chat member-validation block into one helper.
--
-- get_or_create_channel + create_named_channel (014_chat.sql) and upsert_chat_draft
-- (015_chat_drafts.sql) each repeated the same four steps: derive the caller's nation,
-- canonicalize {caller} ∪ p_members (sorted, deduped), require ≥2 members, and verify
-- every member is an assigned nation in the game. canonical_channel_members() now owns
-- that logic, so the dedup key and the validation rules are guaranteed identical across
-- channels and drafts (they MUST match — a draft reuses its channel's member set).
--
-- Recreates the three RPCs to call the helper; behavior is otherwise unchanged. The
-- function signatures are untouched, so existing grants carry over (no re-grant needed).

-- ── helper ───────────────────────────────────────────────────────────────────
-- Returns the canonical member set ({caller} ∪ p_members, sorted + deduped) after
-- validating it; raises on any failure. Called only by the security-definer RPCs below.
create or replace function public.canonical_channel_members(
  p_game_id uuid,
  p_members text[]
) returns text[] as $$
declare
  me            text;
  canonical     text[];
  valid_nations text[];
begin
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

  return canonical;
end;
$$ language plpgsql security definer stable;

-- ── channel RPCs (014) ─────────────────────────────────────────────────────────

create or replace function public.get_or_create_channel(
  p_game_id uuid,
  p_members text[]
) returns public.chat_channels as $$
declare
  canonical text[];
  ch        public.chat_channels;
begin
  canonical := public.canonical_channel_members(p_game_id, p_members);

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
  canonical text[];
  ch        public.chat_channels;
begin
  canonical := public.canonical_channel_members(p_game_id, p_members);

  if p_name is null or length(trim(p_name)) = 0 then raise exception 'A name is required'; end if;
  if length(p_name) > 60 then raise exception 'Name too long (max 60 characters)'; end if;

  insert into public.chat_channels (game_id, members, is_public, name)
  values (p_game_id, canonical, false, trim(p_name))
  returning * into ch;

  return ch;
end;
$$ language plpgsql security definer;

-- ── draft RPC (015) ──────────────────────────────────────────────────────────
-- Still needs the caller's nation for the row's owner/`nation` column; current_nation
-- is a cheap indexed lookup and the helper has already proven it non-null.
create or replace function public.upsert_chat_draft(
  p_game_id uuid,
  p_members text[],
  p_name    text,
  p_body    text
) returns public.chat_drafts as $$
declare
  me        text;
  canonical text[];
  nm        text;
  d         public.chat_drafts;
begin
  canonical := public.canonical_channel_members(p_game_id, p_members);
  me        := public.current_nation(p_game_id);

  nm := nullif(trim(coalesce(p_name, '')), '');
  if nm is not null and length(nm) > 60 then raise exception 'Name too long (max 60 characters)'; end if;
  if p_body is not null and length(p_body) > 2000 then raise exception 'Message too long (max 2000 characters)'; end if;

  update public.chat_drafts
     set body = coalesce(p_body, ''), updated_at = now()
   where game_id = p_game_id and nation = me and members = canonical
     and coalesce(name, '') = coalesce(nm, '')
  returning * into d;

  if not found then
    insert into public.chat_drafts (game_id, nation, members, name, body)
    values (p_game_id, me, canonical, nm, coalesce(p_body, ''))
    returning * into d;
  end if;

  return d;
end;
$$ language plpgsql security definer;
