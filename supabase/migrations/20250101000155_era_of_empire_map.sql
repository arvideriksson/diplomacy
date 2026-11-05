-- Era of Empire (Asia, 1870): the third map. public.maps mirrors src/lib/maps/era.ts
-- (power ids in order, starting year); src/lib/maps/sqlSeed.test.ts checks they agree.
insert into public.maps (id, powers, starting_year) values
  ('era', array['britain', 'china', 'france', 'japan', 'netherlands', 'russia', 'turkey'], 1870)
on conflict (id) do update
  set powers = excluded.powers, starting_year = excluded.starting_year;
