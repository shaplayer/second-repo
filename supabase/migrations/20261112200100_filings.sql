-- SEC filings, one row per accession number. The ingestion worker writes these the moment a filing
-- appears in the SEC's feed; re-reading the feed is harmless because the accession number is the key.
create table public.filings (
  accession text primary key check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),  -- 0000320193-26-000018
  cik bigint not null references public.companies (cik),
  form text not null check (btrim(form) <> ''),        -- 8-K, 10-Q, 10-K, 4, DEF 14A, S-1 (and /A)
  items text[] not null default '{}',                  -- 8-K item numbers, e.g. {2.02,9.01}
  accepted_at timestamptz not null,                    -- when the SEC accepted it
  filed_date date not null,
  -- Only links to the SEC's own archive are ever stored (plan 1.7a).
  primary_url text not null check (primary_url like 'https://www.sec.gov/Archives/%'),
  index_url text not null check (index_url like 'https://www.sec.gov/Archives/%'),
  ingested_at timestamptz not null default now()
);
create index filings_company_newest on public.filings (cik, accepted_at desc);
create index filings_form_newest on public.filings (form, accepted_at desc);
create index filings_newest on public.filings (accepted_at desc);

alter table public.filings enable row level security;
