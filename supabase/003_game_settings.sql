-- Add settings column for game configuration

alter table public.games
  add column if not exists settings jsonb not null default '{
    "turn_timer": "24h",
    "variant": "standard",
    "allow_spectators": true,
    "random_nations": false
  }';
