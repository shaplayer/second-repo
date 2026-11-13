-- The waiting list for plain-English summaries (plan Phase 3). A filing or press release is put on
-- it when someone opens it, or when a company with active alert subscriptions posts something. The
-- unique rules make sure an item is only ever on the list once, so two workers never write the same
-- summary twice.
create table public.summary_jobs (
  id bigint generated always as identity primary key,
  accession text unique references public.filings (accession) on delete cascade,
  news_id bigint unique references public.news (id) on delete cascade,
  reason text not null check (reason in ('viewed', 'subscribed', 'pick', 'backfill')),
  status text not null default 'queued' check (status in ('queued', 'working', 'done', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint summary_jobs_one_subject check ((accession is not null) <> (news_id is not null))
);
create index summary_jobs_queue on public.summary_jobs (next_attempt_at) where status = 'queued';

alter table public.summary_jobs enable row level security;
