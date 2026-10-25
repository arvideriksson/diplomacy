-- Raise the chat message cap from 2000 to 5000 characters (~800 words) so long-form
-- press (alliance proposals, multi-turn plans) fits. Re-issues send_chat_message
-- (137) and upsert_chat_draft (123) unchanged apart from the limit. The client
-- mirrors it as BODY_MAX in src/lib/chatStore.ts.

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
  if length(p_body) > 5000 then
    raise exception 'Message too long (max 5000 characters)';
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
  if p_body is not null and length(p_body) > 5000 then raise exception 'Message too long (max 5000 characters)'; end if;

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
