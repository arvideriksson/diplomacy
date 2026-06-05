-- Drop invite codes in favor of share-by-link.
--
-- A game's UUID is itself an unguessable capability: join_public_game() already
-- adds the caller to any lobby game by id (it never checks is_private), so the
-- magic link /join/<game-id> is all we need. The short invite_code, its
-- generator trigger, and the join_game_by_code RPC are now dead weight.

drop trigger if exists games_invite_code on public.games;
drop function if exists public.generate_invite_code();
drop function if exists public.join_game_by_code(text);

alter table public.games drop column if exists invite_code;
