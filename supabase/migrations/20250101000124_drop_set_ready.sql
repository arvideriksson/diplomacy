-- Drop the unused set_ready RPC.
--
-- set_ready (111_orders_rpc.sql, revised in 119_early_resolution.sql) was a standalone
-- "toggle ready without resubmitting orders" path. The implemented UI never wired it up:
-- readiness is folded into the order flow instead — submit_orders(..., p_ready => true)
-- readies and writes orders in one call, and editing orders un-readies. The setReady()
-- client wrapper had zero callers and has been removed.
--
-- Its only dependency, maybe_resolve_now, stays — submit_orders still calls it.

drop function if exists public.set_ready(uuid, boolean);
