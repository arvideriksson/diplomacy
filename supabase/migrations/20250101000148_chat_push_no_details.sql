-- ── notify_chat_message (re-issues 147): no sender or text in the push ──────────
-- A notification shows on the lock screen, so press stays private: only which game
-- has a new message. Still one notification per channel (the tag).
create or replace function public.notify_chat_message()
returns trigger as $$
declare
  c public.chat_channels;
  g public.games;
begin
  select * into c from public.chat_channels where id = new.channel_id;
  select * into g from public.games where id = c.game_id;

  perform public.push_notify(
    public.nation_users(g.players, array_remove(c.members, new.sender)),
    jsonb_build_object(
      'title', g.name,
      'body',  'New message!',
      'url',   '/game/' || g.id,
      'tag',   'chat:' || c.id));
  return null;
end;
$$ language plpgsql security definer;
