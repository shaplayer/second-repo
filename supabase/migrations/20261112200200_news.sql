-- Where news comes from, and what each source lets us do with its text.
-- SEC filings are public domain. Newswire and other publishers' text is theirs: until the owner has an
-- agreement or has had the feed's terms checked, we keep only the headline, time, source and link
-- (can_store_body and can_summarize stay false). Plan decision 10.
create table public.news_sources (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null,                         -- shown to readers, e.g. "PR Newswire"
  enabled boolean not null default false,     -- the worker reads this source
  can_store_body boolean not null default false,
  can_summarize boolean not null default false,
  terms_note text,                            -- what was agreed or checked, by whom, when
  created_at timestamptz not null default now()
);

insert into public.news_sources (key, name, enabled, can_store_body, can_summarize, terms_note) values
  ('sec',            'SEC.gov',         true,  true,  true,  'Press releases filed with the SEC as 8-K exhibits. Public domain.'),
  ('prnewswire',     'PR Newswire',     true,  false, false, 'Public RSS feed. Headline and link only until the feed terms are checked.'),
  ('businesswire',   'Business Wire',   true,  false, false, 'Public RSS feed. Headline and link only until the feed terms are checked.'),
  ('globenewswire',  'GlobeNewswire',   false, false, false, 'Feed refused automated readers in Nov 2026. Off until that changes.'),
  ('accessnewswire', 'ACCESS Newswire', false, false, false, 'Feed refused automated readers in Nov 2026. Off until that changes.'),
  ('benzinga',       'Benzinga',        false, false, false, 'Needs a licence or API agreement before it is switched on.'),
  ('stocktitan',     'Stock Titan',     false, false, false, 'Needs permission or a feed agreement before it is switched on.');

-- Press releases and company news.
create table public.news (
  id bigint generated always as identity primary key,
  source text not null references public.news_sources (key),
  accession text references public.filings (accession),  -- SEC rows only: the 8-K the release was attached to
  exhibit text,                                          -- SEC rows only, e.g. EX-99.1
  cik bigint references public.companies (cik),          -- empty when the company is not in our list
  ticker text,                                           -- as the source gave it
  company_name text,
  title text not null check (btrim(title) <> ''),
  body_text text,                                        -- plain text; stored only where the source allows it
  url text not null unique check (url like 'https://%'),
  published_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  unique (accession, exhibit),
  constraint news_sec_rows_point_at_sec check (
    (source = 'sec' and accession is not null and exhibit is not null and cik is not null
      and url like 'https://www.sec.gov/Archives/%')
    or (source <> 'sec' and accession is null and exhibit is null)
  )
);
create index news_newest on public.news (published_at desc);
create index news_company_newest on public.news (cik, published_at desc);
create index news_ticker_newest on public.news (ticker, published_at desc);

alter table public.news_sources enable row level security;
alter table public.news enable row level security;
