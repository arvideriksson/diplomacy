-- Add private game support

alter table public.games
  add column if not exists is_private boolean not null default false,
  add column if not exists invite_code text unique;

-- Generate a short invite code for private games
create or replace function public.generate_invite_code()
returns trigger as $$
begin
  if new.is_private and new.invite_code is null then
    new.invite_code = upper(substr(md5(random()::text), 1, 6));
  end if;
  if not new.is_private then
    new.invite_code = null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger games_invite_code
  before insert or update on public.games
  for each row
  execute function public.generate_invite_code();

-- Replace the old "view all" policy with one that respects privacy
drop policy if exists "Users can view all games" on public.games;

create policy "Users can view visible games"
  on public.games for select
  to authenticated
  using (
    not is_private
    or created_by = auth.uid()
    or players ? (auth.uid()::text)
  );

-- Allow any authenticated user to read a game by invite code (via RPC)
create or replace function public.join_game_by_code(code text)
returns uuid as $$
declare
  game_id uuid;
begin
  select id into game_id
    from public.games
    where invite_code = upper(code);

  if game_id is null then
    raise exception 'Invalid invite code';
  end if;

  update public.games
    set players = players || jsonb_build_object(auth.uid()::text, 'pending')
    where id = game_id;

  return game_id;
end;
$$ language plpgsql security definer;
