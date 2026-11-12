-- Data that used to live in data/store.json. Only the server (secret key) reads or writes these tables.

create table public.alert_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  token text not null unique,
  confirmed boolean not null default false,
  tickers text[] not null default '{}',
  prefs jsonb not null default '{"earnings": true, "news": true, "insider": false, "picks": false, "mode": "instant"}',
  created_at timestamptz not null default now()
);
create index alert_subscribers_tickers on public.alert_subscribers using gin (tickers) where confirmed;

create table public.filing_summaries (
  accession text primary key,
  ticker text not null,
  company_name text not null,
  form text not null,
  accepted timestamptz not null,
  url text not null,
  headline text not null,
  bullets text[] not null,
  why_it_matters text not null,
  tone text not null,
  importance text not null,
  category text not null,
  created_at timestamptz not null default now()
);
create index filing_summaries_ticker on public.filing_summaries (ticker, accepted desc);

create table public.seen_filings (
  accession text primary key,
  seen_at timestamptz not null default now()
);

create table public.digest_queue (
  subscriber_id uuid not null references public.alert_subscribers (id) on delete cascade,
  accession text not null references public.filing_summaries (accession) on delete cascade,
  queued_at timestamptz not null default now(),
  primary key (subscriber_id, accession)
);
create index digest_queue_accession on public.digest_queue (accession);

create table public.app_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table public.picks (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text not null,
  kind text not null check (kind in ('pick', 'sponsored')),
  title text not null,
  why text not null,
  author text not null,
  tier text not null check (tier in ('free', 'members')),
  posted_at timestamptz not null default now(),
  price_at_post numeric not null,
  owns_shares boolean not null,
  ownership_note text not null default '',
  sponsor jsonb,
  closed_at timestamptz,
  price_at_close numeric,
  -- Section 17(b): a sponsored post must name who paid, how much, and in what form.
  constraint sponsored_needs_disclosure check (
    kind = 'pick' or (sponsor ? 'payer' and sponsor ? 'amount' and sponsor ? 'form')
  )
);
create index picks_ticker on public.picks (ticker);
create index picks_posted on public.picks (posted_at desc);

-- Picks can be closed but never deleted, so the track record stays honest.
create function public.prevent_pick_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Picks cannot be deleted. Close the pick instead.';
end;
$$;
create trigger picks_no_delete before delete on public.picks for each row execute function public.prevent_pick_delete();
revoke execute on function public.prevent_pick_delete() from public, anon, authenticated;

alter table public.alert_subscribers enable row level security;
alter table public.filing_summaries enable row level security;
alter table public.seen_filings enable row level security;
alter table public.digest_queue enable row level security;
alter table public.app_state enable row level security;
alter table public.picks enable row level security;
