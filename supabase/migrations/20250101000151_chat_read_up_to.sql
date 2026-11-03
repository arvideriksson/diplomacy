-- ── mark_chat_read: advance the cursor to what the reader actually saw ─────────────
-- mark_chat_read (137) set the cursor to now(), so a message committed but not yet on
-- the reader's screen (its broadcast still in flight, or missed) counted as read and
-- never got an unread badge, even after a reload. The client now passes the newest
-- message it is showing; the cursor only moves forward and never past the server's
-- clock. Called without it (an older client) it keeps the old now() behavior.

drop function if exists public.mark_chat_read(bigint);

create or replace function public.mark_chat_read(p_channel_id bigint, p_up_to timestamptz default null)
returns void as $$
declare me text; upto timestamptz := least(coalesce(p_up_to, now()), now());
begin
  me := public.require_chat_member(p_channel_id, 'Not a member of this channel');

  insert into public.chat_reads (channel_id, nation, last_read_at)
  values (p_channel_id, me, upto)
  on conflict (channel_id, nation)
    do update set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at);
end;
$$ language plpgsql security definer;

grant execute on function public.mark_chat_read(bigint, timestamptz) to authenticated;
