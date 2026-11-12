-- Companies: one row per SEC registrant (its CIK number).
-- Filled from the SEC's ticker list by scripts/load-companies.ts. The ingestion worker adds a row when a
-- filing arrives from a company we have not seen, for example one filing to go public, which has no
-- ticker yet (so ticker may be empty).
create table public.companies (
  cik bigint primary key check (cik > 0),
  ticker text unique check (ticker is null or ticker ~ '^[A-Z][A-Z0-9.]{0,9}$'),  -- main ticker, BRK.B style
  name text not null check (btrim(name) <> ''),
  exchange text,                 -- as the SEC lists it: Nasdaq, NYSE, OTC, CBOE
  tv_symbol text,                -- symbol handed to the TradingView widgets, e.g. NASDAQ:AAPL
  sic text,
  sic_description text,
  website text,
  phone text,
  fiscal_year_end text,          -- month and day, e.g. 1231
  is_emerging_growth boolean,    -- the SEC "emerging growth company" box (plan decision 9); empty = not checked yet
  tracked boolean not null default false,  -- gets nightly financial snapshots
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_name_lower on public.companies (lower(name) text_pattern_ops);
create index companies_tracked on public.companies (cik) where tracked;

-- Every ticker a company trades under (share classes, units, warrants). companies.ticker is the main one.
create table public.company_tickers (
  ticker text primary key check (ticker ~ '^[A-Z][A-Z0-9.]{0,9}$'),
  cik bigint not null references public.companies (cik) on delete cascade,
  exchange text,
  is_primary boolean not null default false
);
create index company_tickers_cik on public.company_tickers (cik);
create unique index company_tickers_one_primary on public.company_tickers (cik) where is_primary;

-- Server-only: row-level security on with no policies, so only the server can read or write.
alter table public.companies enable row level security;
alter table public.company_tickers enable row level security;
