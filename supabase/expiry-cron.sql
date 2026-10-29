-- Schedules the server-side cleanup of expired share sessions (runs even when the booth app is closed).
-- Run ONCE in Supabase Dashboard → SQL Editor, AFTER supabase/setup.sql and AFTER deploying the function:
--     npx supabase functions deploy expire-shares --no-verify-jwt
-- 1) Replace YOUR-PROJECT-REF below with your project ref (the xxxx in https://xxxx.supabase.co). Safe to re-run.
-- 2) '30 seconds' needs Postgres 15.1.1.61+ (all current projects). On an older project use '* * * * *' (every minute).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'photobooth-expire-shares';

select cron.schedule(
  'photobooth-expire-shares',
  '30 seconds',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/expire-shares',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Check it is running:   select * from cron.job_run_details order by start_time desc limit 5;
