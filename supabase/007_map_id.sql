-- Record which map variant each game uses. Defaults to the standard board so
-- existing rows remain valid. The value is a key into the client-side map
-- registry (see src/lib/maps/index.ts).

alter table public.games
  add column if not exists map_id text not null default 'standard';
