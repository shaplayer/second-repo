-- The feed's filters need to know what kind of news each filing is without re-deriving it on every
-- page view, and the summaries gain the "in one sentence" line the approved design shows.

-- Which filter and alert setting a filing belongs to (lib/plain.ts decides). Empty until the worker
-- has classified it; a filing with no category is not shown in the feed.
alter table public.filings
  add column category text check (category is null or category in ('earnings', 'news', 'insider', 'ipo', 'proxy'));
create index filings_category_newest on public.filings (category, accepted_at desc) where category is not null;

-- "In one sentence": what happened. Summaries copied from the old app do not have it; pages fall
-- back to the headline for those.
alter table public.summaries add column one_sentence text;
