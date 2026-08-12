-- Rename the standard/default board's registry key from 'standard' to 'classical',
-- matching the godip/Diplicity convention and the existing classical.dsvg asset.
-- The map_id is a key into the client-side map registry (see src/lib/maps/index.ts);
-- 'standard' no longer exists there, so migrate the column default and existing rows.

alter table public.games
  alter column map_id set default 'classical';

update public.games
  set map_id = 'classical'
  where map_id = 'standard';
