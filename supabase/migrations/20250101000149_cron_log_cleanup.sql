-- ── Prune pg_cron's run log ─────────────────────────────────────────────────────
-- pg_cron writes a cron.job_run_details row for every run, and diplomacy-tick runs
-- every minute (~43k rows a month) whether or not any game is due. Nothing deleted
-- them, so it was the largest table in the database. Keep a week for debugging.
-- cron.schedule upserts by job name, so re-running this is safe.
select cron.schedule(
  'diplomacy-prune-cron-log',
  '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
