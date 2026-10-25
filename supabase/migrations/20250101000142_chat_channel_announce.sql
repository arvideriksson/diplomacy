-- Announce new and renamed chat channels over Realtime instead of client polling.
--
-- Messages already arrive by Broadcast on each channel's private topic (114), but a
-- conversation another power opens mid-game had to be discovered by re-listing
-- chat_channels every few seconds from every open press panel — steady egress for
-- nothing. Now a trigger broadcasts the channel row to each member's private inbox
-- topic `chat-inbox:<game_id>:<nation>`, so only the members learn it exists (a shared
-- per-game topic would leak who is talking to whom). Clients still re-list on tab focus
-- and reconnect, since Broadcast only reaches online subscribers.

create or replace function public.announce_chat_channel()
returns trigger as $$
declare m text;
begin
  foreach m in array new.members loop
    perform realtime.send(to_jsonb(new), 'channel', 'chat-inbox:' || new.game_id::text || ':' || m, true);
  end loop;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists chat_channels_announce on public.chat_channels;
create trigger chat_channels_announce
  after insert or update of name, members on public.chat_channels
  for each row execute function public.announce_chat_channel();

-- Receive: only the inbox of the caller's own nation in that game. Each predicate casts
-- its topic only once the prefix matches, so the two policies can never trip over each
-- other's topic format (chat_realtime_receive re-issued with the same guard).
drop policy if exists "chat_inbox_receive" on realtime.messages;
create policy "chat_inbox_receive"
  on realtime.messages for select to authenticated
  using (
    case when topic like 'chat-inbox:%'
      then public.current_nation(split_part(topic, ':', 2)::uuid) = split_part(topic, ':', 3)
      else false
    end
  );

drop policy if exists "chat_realtime_receive" on realtime.messages;
create policy "chat_realtime_receive"
  on realtime.messages for select to authenticated
  using (
    case when topic like 'chat:%'
      then public.chat_member_of(split_part(topic, ':', 2)::bigint)
      else false
    end
  );
