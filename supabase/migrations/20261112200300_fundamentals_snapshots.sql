-- Nightly snapshot of a company's SEC financial numbers and its health check. Pages read the newest row.
create table public.fundamentals_snapshots (
  cik bigint not null references public.companies (cik) on delete cascade,
  as_of date not null,                 -- the night it was taken
  quarters jsonb not null,             -- last 8 quarters: sales, profit, margin
  ttm jsonb not null,                  -- last 12 months: sales, profit, dividend per share, shares outstanding
  score jsonb,                         -- every check with its answer for each of the last 4 quarters
  verdict text check (verdict in ('Strong', 'Mixed', 'Weak')),   -- empty = no score
  rule_set text not null default 'standard' check (rule_set in ('standard', 'growth')),  -- plan decision 9
  no_score_reason text,                -- why there is no verdict, in plain English
  source_filed date,                   -- newest filing the numbers came from
  created_at timestamptz not null default now(),
  primary key (cik, as_of),
  check (verdict is not null or no_score_reason is not null)
);

alter table public.fundamentals_snapshots enable row level security;
