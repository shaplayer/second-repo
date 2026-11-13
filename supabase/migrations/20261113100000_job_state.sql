-- One row per background job of the worker: when it last ran, when it last worked, and what went
-- wrong last. The health page and `npm run feeds:check` read this; nothing else depends on it.
create table public.job_state (
  job text primary key check (job ~ '^[a-z][a-z0-9_.:-]{1,60}$'),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  detail jsonb not null default '{}'::jsonb,   -- small counters and positions, e.g. the newest filing seen
  updated_at timestamptz not null default now()
);

alter table public.job_state enable row level security;
