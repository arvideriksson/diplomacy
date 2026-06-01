-- Run this in your Supabase SQL Editor to set up the games table

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phase text not null default 'lobby',
  year integer not null default 1901,
  season text not null default 'Spring',
  players jsonb not null default '{}',
  units jsonb not null default '[]',
  created_by uuid references auth.users(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.games enable row level security;

create policy "Users can view all games"
  on public.games for select
  to authenticated
  using (true);

create policy "Users can create games"
  on public.games for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Game creator can update"
  on public.games for update
  to authenticated
  using (auth.uid() = created_by);

-- Enable realtime for the games table
alter publication supabase_realtime add table public.games;

-- Auto-update updated_at on row changes
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger games_updated_at
  before update on public.games
  for each row
  execute function public.update_updated_at();
