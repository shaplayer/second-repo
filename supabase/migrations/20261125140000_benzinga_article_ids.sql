-- Preserve the existing URL/quote deduplication rules while tracking Benzinga's article IDs.
create table public.benzinga_articles (
  article_id text primary key,
  news_id bigint not null references public.news (id) on delete cascade
);
insert into public.benzinga_articles (article_id, news_id)
select source_item_id, id from public.news where source = 'benzinga' and source_item_id is not null;
alter table public.benzinga_articles enable row level security;
revoke all on table public.benzinga_articles from anon, authenticated;
