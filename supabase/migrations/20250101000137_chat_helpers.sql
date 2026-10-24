-- Chat: one definition of "the caller is a member of this channel" and of "this draft
-- is the caller's".
--
-- The membership predicate `current_nation(game_id) = any(members)` was written out in
-- the chat_channels select policy and chat_member_of (114), and as a load-then-check in
-- rename_channel, send_chat_message and mark_chat_read (114). The draft-ownership check
-- was repeated in rename_chat_draft and delete_chat_draft (115). Now:
--   • chat_is_member(game_id, members) — the row predicate (policy + chat_member_of);
--   • require_chat_member(channel, msg) — load + check for the RPCs, returns the nation;
--   • own_chat_draft(draft)             — existence + ownership for the draft RPCs.
-- Error messages, and the order checks run in, are unchanged. RPC signatures are
-- unchanged, so their grants carry over.

-- ── helpers ───────────────────────────────────────────────────────────────────

-- Is the caller's nation among a channel's members? Evaluated by the chat_channels
-- select policy as the querying user, so it is granted to authenticated (it reveals
-- nothing current_nation() doesn't). Plain SQL so the policy can inline it.
create or replace function public.chat_is_member(p_game_id uuid, p_members text[])
returns boolean as $$
  select public.current_nation(p_game_id) = any(p_members);
$$ language sql stable;

grant execute on function public.chat_is_member(uuid, text[]) to authenticated;

-- The caller's nation in a channel they belong to. Raises 'Channel not found', or
-- p_denied when the caller is not a member. Private.
create or replace function public.require_chat_member(p_channel_id bigint, p_denied text)
returns text as $$
declare me text; g_id uuid; mems text[];
begin
  select c.game_id, c.members into g_id, mems
    from public.chat_channels c where c.id = p_channel_id;
  if g_id is null then raise exception 'Channel not found'; end if;

  me := public.current_nation(g_id);
  if me is null or not (me = any(mems)) then raise exception '%', p_denied; end if;
  return me;
end;
$$ language plpgsql security definer stable;

-- Does the draft exist (false if not)? Raises 'Not your draft' when it is another
-- nation's. Private.
create or replace function public.own_chat_draft(p_draft_id bigint)
returns boolean as $$
declare g_id uuid; own text;
begin
  select game_id, nation into g_id, own from public.chat_drafts where id = p_draft_id;
  if g_id is null then return false; end if;
  if public.current_nation(g_id) is distinct from own then
    raise exception 'Not your draft';
  end if;
  return true;
end;
$$ language plpgsql security definer stable;

-- ── membership predicate ──────────────────────────────────────────────────────

-- chat_member_of (re-issues 114).
create or replace function public.chat_member_of(p_channel_id bigint)
returns boolean as $$
  select exists (
    select 1 from public.chat_channels c
    where c.id = p_channel_id
      and public.chat_is_member(c.game_id, c.members)
  );
$$ language sql security definer stable;

drop policy if exists "chat_channels_select_member" on public.chat_channels;
create policy "chat_channels_select_member"
  on public.chat_channels for select to authenticated
  using (public.chat_is_member(game_id, members));

-- ── channel RPCs (re-issue 114) ────────────────────────────────────────────────

-- Rename a channel. Any member may rename it; the public channel cannot be renamed.
create or replace function public.rename_channel(
  p_channel_id bigint,
  p_name       text
) returns void as $$
declare pub boolean;
begin
  select c.is_public into pub from public.chat_channels c where c.id = p_channel_id;
  if not found then raise exception 'Channel not found'; end if;
  if pub then raise exception 'The public channel cannot be renamed'; end if;

  perform public.require_chat_member(p_channel_id, 'Not a member of this channel');

  if p_name is null or length(trim(p_name)) = 0 then raise exception 'A name is required'; end if;
  if length(p_name) > 60 then raise exception 'Name too long (max 60 characters)'; end if;

  update public.chat_channels set name = trim(p_name) where id = p_channel_id;
end;
$$ language plpgsql security definer;

-- Append one message and deliver it as a single full-payload Broadcast to the
-- channel's private topic. The sender is recorded as read.
create or replace function public.send_chat_message(
  p_channel_id bigint,
  p_body       text
) returns public.chat_messages as $$
declare
  me  text;
  msg public.chat_messages;
begin
  me := public.require_chat_member(p_channel_id, 'You are not a member of this channel');

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
declare me text;
begin
  me := public.require_chat_member(p_channel_id, 'Not a member of this channel');

  insert into public.chat_reads (channel_id, nation, last_read_at)
  values (p_channel_id, me, now())
  on conflict (channel_id, nation) do update set last_read_at = now();
end;
$$ language plpgsql security definer;

-- ── draft RPCs (re-issue 115) ──────────────────────────────────────────────────

create or replace function public.rename_chat_draft(
  p_draft_id bigint,
  p_name     text
) returns public.chat_drafts as $$
declare nm text; d public.chat_drafts;
begin
  if not public.own_chat_draft(p_draft_id) then raise exception 'Draft not found'; end if;

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
begin
  if not public.own_chat_draft(p_draft_id) then return; end if;  -- already gone
  delete from public.chat_drafts where id = p_draft_id;
end;
$$ language plpgsql security definer;
