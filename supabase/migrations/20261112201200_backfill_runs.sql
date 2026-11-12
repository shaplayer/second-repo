-- A record of every saved run of the copy from the two old databases (scripts/backfill.ts): when it
-- ran, whether it was the switch-over run, and the full report of what was read, copied and skipped.
-- It is the evidence of what was moved, and a recorded switch-over run stops an accidental re-run from
-- putting old data over changes made on the new site.
create table public.backfill_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  cutover boolean not null default false,
  ok boolean not null,
  report jsonb not null
);

alter table public.backfill_runs enable row level security;
