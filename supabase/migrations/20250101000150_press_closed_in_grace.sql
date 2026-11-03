-- ── Press closes once the deadline passes ───────────────────────────────────────
-- From a phase's deadline until it resolves (the grace period, and the moment between
-- the deadline and the adjudicator committing when there is none) no press can be sent,
-- so none is received; what was said before stays readable. Late powers get time to
-- enter orders, not to negotiate. Press reopens with the next round's deadline, or if a
-- host moves this deadline later. The client mirrors this as pressClosed() in
-- src/lib/game.ts, to swap the compose box for a notice.

-- Ungranted helper: only send_chat_message (definer) calls it.
create or replace function public.press_closed(p_game_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.games g
     where g.id = p_game_id
       and public.is_order_phase(g.phase)
       and g.deadline is not null
       and g.deadline <= now());
$$ language sql stable security definer;
revoke execute on function public.press_closed(uuid) from public, anon, authenticated;

-- send_chat_message (re-issues 145): adds the press_closed check; otherwise unchanged.
create or replace function public.send_chat_message(
  p_channel_id bigint,
  p_body       text
) returns public.chat_messages as $$
declare
  me  text;
  msg public.chat_messages;
begin
  me := public.require_chat_member(p_channel_id, 'You are not a member of this channel');

  if public.press_closed((select game_id from public.chat_channels where id = p_channel_id)) then
    raise exception 'Press is closed until this round resolves';
  end if;
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
