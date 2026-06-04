-- Private per-nation message drafts. Apply after 014.
--
-- A "draft" is a conversation a player has started composing but not yet sent into.
-- Per the chat economy (014), the shared chat_channels row is NOT created until the
-- first message is sent — but a player's own in-progress draft (recipient set, optional
-- name, unsent body) is saved here so it survives reload and switching away. Drafts are
-- PRIVATE: only the owning nation can read/write them, and the row is deleted the moment
-- the draft is sent (which is what creates the real channel). Rows are tiny and self-
-- cleaning, and the table is intentionally NOT in the realtime publication — a draft is
-- yours alone, so there is nothing to broadcast.
--
-- current_nation(game_id) is defined in 010_orders_rls.sql and reused throughout.

-- ── table ──────────────────────────────────────────────────────────────────────

create table if not exists public.chat_drafts (
  id         bigint generated always as identity primary key,
  game_id    uuid    not null references public.games(id) on delete cascade,
  nation     text    not null,                  -- owner; only this nation sees the draft
  members    text[]  not null,                  -- sorted, deduped recipient set (incl. owner)
  name       text,                              -- null = unnamed group / DM
  body       text    not null default '',       -- unsent compose text
  updated_at timestamptz not null default now()
);

create index if not exists chat_drafts_owner_idx on public.chat_drafts (game_id, nation);

-- One draft per (owner, recipient set, name): the unnamed draft and each named variant
-- for a set are distinct. coalesce folds null names so the unnamed slot is unique too.
create unique index if not exists chat_drafts_uq
  on public.chat_drafts (game_id, nation, members, coalesce(name, ''));

alter table public.chat_drafts enable row level security;

-- A draft is visible only to its owner. All writes go through the security-definer RPCs
-- below, so there are deliberately no insert/update/delete policies.
drop policy if exists "chat_drafts_select_own" on public.chat_drafts;
create policy "chat_drafts_select_own"
  on public.chat_drafts for select to authenticated
  using (public.current_nation(game_id) = nation);

-- ── RPCs (the only write path) ─────────────────────────────────────────────────

-- Create or update the caller's draft for a recipient set (+ optional name). Returns the
-- row so the client gets its stable id. Members are canonicalized like the channel RPCs
-- (sorted, deduped, always includes the caller), so the dedup key matches a channel's.
create or replace function public.upsert_chat_draft(
  p_game_id uuid,
  p_members text[],
  p_name    text,
  p_body    text
) returns public.chat_drafts as $$
declare
  me            text;
  canonical     text[];
  valid_nations text[];
  nm            text;
  d             public.chat_drafts;
begin
  me := public.current_nation(p_game_id);
  if me is null then raise exception 'You are not a player in this game'; end if;

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

-- Rename one of the caller's drafts (by id, so the recipient set is untouched). A
-- separate path from upsert because the name is part of the dedup key — upserting a new
-- name would fork a second draft instead of renaming this one.
create or replace function public.rename_chat_draft(
  p_draft_id bigint,
  p_name     text
) returns public.chat_drafts as $$
declare g_id uuid; own text; nm text; d public.chat_drafts;
begin
  select game_id, nation into g_id, own from public.chat_drafts where id = p_draft_id;
  if g_id is null then raise exception 'Draft not found'; end if;
  if public.current_nation(g_id) is distinct from own then
    raise exception 'Not your draft';
  end if;

  nm := nullif(trim(coalesce(p_name, '')), '');
  if nm is not null and length(nm) > 60 then raise exception 'Name too long (max 60 characters)'; end if;

  update public.chat_drafts set name = nm, updated_at = now()
   where id = p_draft_id
  returning * into d;
  return d;
end;
$$ language plpgsql security definer;

-- Delete one of the caller's drafts (on send, or explicit discard). Idempotent.
create or replace function public.delete_chat_draft(p_draft_id bigint)
returns void as $$
declare g_id uuid; own text;
begin
  select game_id, nation into g_id, own from public.chat_drafts where id = p_draft_id;
  if g_id is null then return; end if;  -- already gone
  if public.current_nation(g_id) is distinct from own then
    raise exception 'Not your draft';
  end if;
  delete from public.chat_drafts where id = p_draft_id;
end;
$$ language plpgsql security definer;

grant execute on function public.upsert_chat_draft(uuid, text[], text, text) to authenticated;
grant execute on function public.rename_chat_draft(bigint, text)            to authenticated;
grant execute on function public.delete_chat_draft(bigint)                  to authenticated;
