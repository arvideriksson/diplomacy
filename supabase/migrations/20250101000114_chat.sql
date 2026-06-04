-- Secret group chat ("press"). Apply after 013.
--
-- Design follows the free-tier economy levers:
--   • A channel carries its sorted member set inline, and membership is FIXED at
--     creation, so there is no members table — the secrecy predicate is
--     `current_nation = any(members)` right on the channel row. Unnamed channels dedupe
--     on their member set (auto-reuse); named channels may repeat a set (the name is
--     the differentiator) and any member can rename them.
--   • Rows are lean: bigint/int keys (no uuid PKs), no per-message game_id (reach the
--     game through the channel), sender stored as the nation string (matches
--     games.players / orders.nation).
--   • Live delivery is ONLINE-ONLY, FULL-PAYLOAD Broadcast (no ping+fetch): the send
--     RPC emits one realtime.send carrying the whole row to a private topic. Offline
--     members read missed messages later from the table via a delta (since-cursor) fetch.
--   • These tables are intentionally NOT in the supabase_realtime publication — chat
--     uses Broadcast, never postgres_changes (which bills per client and scales poorly).
--
-- current_nation(game_id) is defined in 010_orders_rls.sql and reused throughout.

-- ── tables ───────────────────────────────────────────────────────────────────

create table if not exists public.chat_channels (
  id         bigint generated always as identity primary key,
  game_id    uuid    not null references public.games(id) on delete cascade,
  members    text[]  not null,                 -- sorted, deduped nation list
  is_public  boolean not null default false,   -- the auto-created all-players press channel
  name       text,                             -- null = unnamed (auto-reused by member set)
  created_at timestamptz not null default now()
);

-- Re-runnable even if an earlier version of this migration already created the table
-- with the old `unique (game_id, members)` constraint (its auto-generated name below).
alter table public.chat_channels add column if not exists name text;
alter table public.chat_channels drop constraint if exists chat_channels_game_id_members_key;

create index if not exists chat_channels_game_idx on public.chat_channels (game_id);

-- UNNAMED channels (DMs, the public channel, quick groups) dedupe on their member set,
-- so "message X" always reopens the one thread. NAMED channels may repeat a member set
-- — the name is the differentiator — so the uniqueness is partial (`where name is null`).
create unique index if not exists chat_channels_unnamed_uq
  on public.chat_channels (game_id, members) where name is null;

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  channel_id bigint not null references public.chat_channels(id) on delete cascade,
  sender     text   not null,                  -- nation; no per-row game_id (lean row)
  body       text   not null,
  created_at timestamptz not null default now()
);

-- Hot path: "messages in this channel since my cursor", oldest→newest.
create index if not exists chat_messages_channel_idx
  on public.chat_messages (channel_id, created_at);

-- Per-(channel, nation) read cursor, updated in place (one row per member per channel).
-- Powers unread badges and the delta-history fetch.
create table if not exists public.chat_reads (
  channel_id   bigint not null references public.chat_channels(id) on delete cascade,
  nation       text   not null,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, nation)
);

alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads    enable row level security;

-- ── helpers ──────────────────────────────────────────────────────────────────

-- Is the caller a member of channel p_channel_id? Used by RLS on messages/reads and
-- by the Realtime Authorization policy below.
create or replace function public.chat_member_of(p_channel_id bigint)
returns boolean as $$
  select exists (
    select 1 from public.chat_channels c
    where c.id = p_channel_id
      and public.current_nation(c.game_id) = any(c.members)
  );
$$ language sql security definer stable;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- A channel and everything in it is visible only to its members. All WRITES go
-- through security-definer RPCs (below) — there are deliberately no insert/update/
-- delete policies, so a client can never forge a message, sender, or membership.

drop policy if exists "chat_channels_select_member" on public.chat_channels;
create policy "chat_channels_select_member"
  on public.chat_channels for select to authenticated
  using (public.current_nation(game_id) = any(members));

drop policy if exists "chat_messages_select_member" on public.chat_messages;
create policy "chat_messages_select_member"
  on public.chat_messages for select to authenticated
  using (public.chat_member_of(channel_id));

drop policy if exists "chat_reads_select_member" on public.chat_reads;
create policy "chat_reads_select_member"
  on public.chat_reads for select to authenticated
  using (public.chat_member_of(channel_id));

-- ── RPCs (the only write path) ─────────────────────────────────────────────────

-- Open or reuse the UNNAMED channel for exactly {caller} ∪ p_members (the auto-reuse
-- path — DMs and quick groups). Membership is fixed: a different set is a different
-- channel. Validates every member is an assigned nation and that the caller is included.
-- For a distinct, repeatable group use create_named_channel instead.
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

-- Create a NAMED group for {caller} ∪ p_members. Always inserts a fresh channel, so
-- the same member set can host several differently-named rooms.
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

-- Rename a channel. Any member may rename it (it's a shared group); the public
-- channel keeps its derived "All players" label and cannot be renamed.
create or replace function public.rename_channel(
  p_channel_id bigint,
  p_name       text
) returns void as $$
declare me text; g_id uuid; mems text[]; pub boolean;
begin
  select c.game_id, c.members, c.is_public into g_id, mems, pub
    from public.chat_channels c where c.id = p_channel_id;
  if g_id is null then raise exception 'Channel not found'; end if;
  if pub then raise exception 'The public channel cannot be renamed'; end if;

  me := public.current_nation(g_id);
  if me is null or not (me = any(mems)) then raise exception 'Not a member of this channel'; end if;

  if p_name is null or length(trim(p_name)) = 0 then raise exception 'A name is required'; end if;
  if length(p_name) > 60 then raise exception 'Name too long (max 60 characters)'; end if;

  update public.chat_channels set name = trim(p_name) where id = p_channel_id;
end;
$$ language plpgsql security definer;

-- Append one message and deliver it. The body is validated, persisted, then sent as
-- a single FULL-PAYLOAD Broadcast to the channel's private topic (online members get
-- it live; offline members pick it up from the table later). The sender is recorded
-- as read, since by definition they've seen their own message.
create or replace function public.send_chat_message(
  p_channel_id bigint,
  p_body       text
) returns public.chat_messages as $$
declare
  me   text;
  g_id uuid;
  mems text[];
  msg  public.chat_messages;
begin
  select c.game_id, c.members into g_id, mems
    from public.chat_channels c where c.id = p_channel_id;
  if g_id is null then raise exception 'Channel not found'; end if;

  me := public.current_nation(g_id);
  if me is null or not (me = any(mems)) then
    raise exception 'You are not a member of this channel';
  end if;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Message is empty';
  end if;
  if length(p_body) > 2000 then
    raise exception 'Message too long (max 2000 characters)';
  end if;

  insert into public.chat_messages (channel_id, sender, body)
  values (p_channel_id, me, trim(p_body))
  returning * into msg;

  -- Online-only, full-payload live delivery. Topic must match the client channel name.
  perform realtime.send(to_jsonb(msg), 'msg', 'chat:' || p_channel_id::text, true);

  insert into public.chat_reads (channel_id, nation, last_read_at)
  values (p_channel_id, me, now())
  on conflict (channel_id, nation) do update set last_read_at = excluded.last_read_at;

  return msg;
end;
$$ language plpgsql security definer;

-- Advance the caller's read cursor for a channel (drives unread badges).
create or replace function public.mark_chat_read(p_channel_id bigint)
returns void as $$
declare me text; g_id uuid; mems text[];
begin
  select c.game_id, c.members into g_id, mems
    from public.chat_channels c where c.id = p_channel_id;
  if g_id is null then raise exception 'Channel not found'; end if;
  me := public.current_nation(g_id);
  if me is null or not (me = any(mems)) then raise exception 'Not a member of this channel'; end if;

  insert into public.chat_reads (channel_id, nation, last_read_at)
  values (p_channel_id, me, now())
  on conflict (channel_id, nation) do update set last_read_at = now();
end;
$$ language plpgsql security definer;

grant execute on function public.get_or_create_channel(uuid, text[])        to authenticated;
grant execute on function public.create_named_channel(uuid, text[], text)   to authenticated;
grant execute on function public.rename_channel(bigint, text)               to authenticated;
grant execute on function public.send_chat_message(bigint, text)            to authenticated;
grant execute on function public.mark_chat_read(bigint)                     to authenticated;
grant execute on function public.chat_member_of(bigint)                     to authenticated;

-- ── auto-create the public press channel when a game starts ────────────────────
-- Fires on the lobby→movement transition (startGame). Members = every assigned
-- nation; fixed thereafter like any other channel.
create or replace function public.create_public_channel()
returns trigger as $$
declare nations text[];
begin
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

drop trigger if exists games_create_public_chat on public.games;
create trigger games_create_public_chat
  after update on public.games
  for each row
  when (old.phase = 'lobby' and new.phase = 'movement')
  execute function public.create_public_channel();

-- ── Realtime Authorization: gate live delivery by membership ───────────────────
-- Private Broadcast topics are 'chat:<channel_id>'. A client may RECEIVE on a topic
-- only if it's a member of that channel — the same secrecy rule as the table, now
-- enforced at subscribe time. We only need SELECT (receive): messages are emitted
-- from the database (send_chat_message), never published by clients, so no client
-- INSERT policy is granted.
alter table realtime.messages enable row level security;

drop policy if exists "chat_realtime_receive" on realtime.messages;
create policy "chat_realtime_receive"
  on realtime.messages for select to authenticated
  using (
    topic like 'chat:%'
    and public.chat_member_of(split_part(topic, ':', 2)::bigint)
  );
