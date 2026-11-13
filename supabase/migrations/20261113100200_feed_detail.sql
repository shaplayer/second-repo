-- Extra facts about each filing, filled in by the worker after the filing is first stored, and the
-- marks that say "alerts have been made for this item".
alter table public.filings
  add column title text,                      -- the first line of the attached press release, when there is one
  add column primary_document text,           -- file name of the main document
  add column detail_checked_at timestamptz,   -- when the filing's list of documents was read
  add column detail_error text,               -- why that failed last time, if it did
  add column matched_at timestamptz;          -- when alerts were made for it (set even when nobody follows the company)

create index filings_detail_todo on public.filings (accepted_at desc) where detail_checked_at is null;
create index filings_match_todo on public.filings (accepted_at) where matched_at is null;

alter table public.news add column matched_at timestamptz;
create index news_match_todo on public.news (published_at) where matched_at is null;

-- A pick can point at the filing or release it is about. matched_at as above.
alter table public.picks
  add column source_url text check (source_url is null or source_url like 'https://%'),
  add column matched_at timestamptz;
create index picks_match_todo on public.picks (posted_at) where matched_at is null and imported_from is null;
