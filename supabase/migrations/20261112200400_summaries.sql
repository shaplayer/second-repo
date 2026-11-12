-- Plain-English summaries: one per filing, or one per news item that did not come with a filing.
-- kind 'ai' = written by Claude (model and prompt version recorded, so old ones can be found and redone
-- after a prompt change). kind 'rule' = built from the filing's own data with no AI (insider trades).
create table public.summaries (
  id bigint generated always as identity primary key,
  accession text unique references public.filings (accession),
  news_id bigint unique references public.news (id),
  kind text not null check (kind in ('ai', 'rule')),
  model text,                                   -- e.g. claude-opus-5-5; empty for 'rule'
  prompt_version int not null,
  headline text not null,
  bullets text[] not null,
  why_it_matters text not null default '',
  tone text not null,
  importance text not null,
  category text not null,
  source_url text not null check (source_url like 'https://%'),  -- what "Read the original" opens
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  constraint summaries_one_subject check ((accession is not null) <> (news_id is not null)),
  constraint summaries_ai_names_its_model check ((kind = 'ai') = (model is not null))
);

alter table public.summaries enable row level security;
