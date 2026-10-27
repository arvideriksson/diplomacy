-- Web Push notifications: a new press message, a new round to order for, and a
-- reminder one hour before the deadline while your orders aren't submitted.
--
-- SQL decides who gets what (it already knows nations, membership and readiness) and
-- hands a ready-made payload to the `notify` Edge Function, which only looks up the
-- recipients' subscriptions and sends. pg_net queues requests transactionally, so a
-- rolled-back resolution or message never notifies anyone.

-- ── subscriptions ───────────────────────────────────────────────────────────────
-- One row per browser/device push endpoint. An endpoint belongs to whoever subscribed
-- last on that device (signing in as someone else re-points it).
create table public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Written only through the RPCs below; nobody reads it but the Edge Function.
alter table public.push_subscriptions enable row level security;

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
) returns void as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$ language plpgsql security definer;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void as $$
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id = auth.uid();
$$ language sql security definer;

grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ── sending ─────────────────────────────────────────────────────────────────────
-- The notify function sits next to the adjudicator and shares its secret, so it is
-- reached through the same private.engine_config row (…/functions/v1/notify).
-- Unconfigured engine or nobody to tell: a silent no-op.
create or replace function public.push_notify(p_user_ids uuid[], p_payload jsonb)
returns void as $$
declare cfg private.engine_config;
begin
  if coalesce(array_length(p_user_ids, 1), 0) = 0 then return; end if;
  select * into cfg from private.engine_config where id;
  if cfg is null then return; end if;

  perform net.http_post(
    url     := regexp_replace(cfg.function_url, '[^/]+$', 'notify'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || cfg.service_key),
    body    := jsonb_build_object('user_ids', to_jsonb(p_user_ids), 'payload', p_payload)
  );
end;
$$ language plpgsql security definer;

-- Users playing the given nations in a players map.
create or replace function public.nation_users(p_players jsonb, p_nations text[])
returns uuid[] as $$
  select coalesce(array_agg(key::uuid), '{}')
    from jsonb_each(p_players)
   where value ->> 'nation' = any(p_nations);
$$ language sql immutable;

-- Nations in a game that haven't readied for the current round.
create or replace function public.unready_nations(g public.games)
returns text[] as $$
  select coalesce(array_agg(n), '{}')
    from unnest(public.game_nations(g.players)) n
   where not public.is_ready(g.ready, n);
$$ language sql stable;

create or replace function public.round_label(g public.games)
returns text as $$
  select g.season || ' ' || g.year || ' · '
      || case g.phase when 'movement' then 'Orders'
                      when 'retreat'  then 'Retreats'
                      when 'build'    then 'Adjustments' end;
$$ language sql immutable;

-- ── press ───────────────────────────────────────────────────────────────────────
-- Every other member of the channel; one notification per channel (the tag), so a
-- burst of messages stacks into the latest.
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
      'body',  initcap(new.sender) || ': ' || left(new.body, 200),
      'url',   '/game/' || g.id,
      'tag',   'chat:' || c.id));
  return null;
end;
$$ language plpgsql security definer;

create trigger chat_messages_notify
  after insert on public.chat_messages
  for each row execute function public.notify_chat_message();

-- ── new round ───────────────────────────────────────────────────────────────────
-- Fires on any change of the round pointer (start, resolution, revert). Nations the
-- adjudicator auto-readied have nothing to order, so they aren't told.
create or replace function public.notify_new_round()
returns trigger as $$
begin
  if public.is_order_phase(new.phase) then
    perform public.push_notify(
      public.nation_users(new.players, public.unready_nations(new)),
      jsonb_build_object(
        'title', new.name,
        'body',  public.round_label(new),
        'url',   '/game/' || new.id,
        'tag',   'round:' || new.id));
  elsif new.phase = 'complete' then
    perform public.push_notify(
      public.nation_users(new.players, public.game_nations(new.players)),
      jsonb_build_object(
        'title', new.name,
        'body',  'Game over',
        'url',   '/game/' || new.id,
        'tag',   'round:' || new.id));
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger games_notify_new_round
  after update of phase, season, year on public.games
  for each row
  when ((old.phase, old.season, old.year) is distinct from (new.phase, new.season, new.year))
  execute function public.notify_new_round();

-- ── deadline reminder ───────────────────────────────────────────────────────────
-- The deadline each game was last reminded for. A new round or a moved deadline is a
-- new value, so it re-arms without any reset.
create table private.deadline_reminders (
  game_id  uuid primary key references public.games(id) on delete cascade,
  deadline timestamptz not null
);

-- An hour out, tell the unready. Phases an hour long or shorter would be reminded the
-- moment they open (on top of the new-round push), so they get none.
create or replace function public.send_deadline_reminders()
returns void as $$
declare g public.games;
begin
  for g in
    select *
      from public.games
     where public.is_order_phase(phase)
       and resolving_at is null
       and deadline > now()
       and deadline <= now() + interval '1 hour'
       and public.phase_timer_minutes(settings, phase) > 60
       and not exists (select 1 from private.deadline_reminders r
                        where r.game_id = games.id and r.deadline = games.deadline)
  loop
    perform public.push_notify(
      public.nation_users(g.players, public.unready_nations(g)),
      jsonb_build_object(
        'title', g.name,
        'body',  public.round_label(g) || ' · 1 hour left',
        'url',   '/game/' || g.id,
        'tag',   'round:' || g.id));
    insert into private.deadline_reminders (game_id, deadline) values (g.id, g.deadline)
    on conflict (game_id) do update set deadline = excluded.deadline;
  end loop;
end;
$$ language plpgsql security definer;

-- ── tick_due_games (re-issues 134): also sends the reminders ───────────────────
create or replace function public.tick_due_games()
returns void as $$
declare g record;
begin
  -- Reap stale locks from crashed/never-completed resolutions FIRST (see cron.sql).
  update public.games
     set resolving_at = null
   where resolving_at is not null
     and resolving_at < now() - interval '5 minutes';

  perform public.send_deadline_reminders();

  for g in
    select id
      from public.games
     where public.is_order_phase(phase)
       and resolving_at is null
       and public.resolution_due(games)
     for update skip locked
  loop
    -- Unconfigured engine: nothing can be fired this tick.
    exit when not public.fire_adjudicator(g.id, '{}'::jsonb, false);
  end loop;
end;
$$ language plpgsql security definer;
