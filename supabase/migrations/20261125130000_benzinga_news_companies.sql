-- Quote-page links can be reused by distinct Benzinga news items.
alter table public.news add column source_item_id text;
alter table public.news drop constraint news_url_key;
create unique index news_url_once on public.news (url) where source_item_id is null;
create unique index news_source_item_once on public.news (source, source_item_id) where source_item_id is not null;

create table public.news_companies (
  news_id bigint not null references public.news (id) on delete cascade,
  cik bigint not null references public.companies (cik),
  primary key (news_id, cik)
);
create index news_companies_by_company on public.news_companies (cik, news_id);
alter table public.news_companies enable row level security;
revoke all on table public.news_companies from anon, authenticated;
