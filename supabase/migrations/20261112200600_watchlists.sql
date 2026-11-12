-- "My stocks": the companies a signed-in person keeps an eye on. Replaces watchlist (which stored tickers).
create table public.watchlists (
  user_id uuid not null references public.users (id) on delete cascade,
  cik bigint not null references public.companies (cik),
  added_at timestamptz not null default now(),
  backfilled_at timestamptz,   -- set only by the migration scripts, for rows copied from the old watchlist
  primary key (user_id, cik)
);
create index watchlists_company on public.watchlists (cik);

alter table public.watchlists enable row level security;

-- People can see their own list. Changes go through the server.
create policy "Users can read their own stocks"
  on public.watchlists for select to authenticated
  using ((select auth.uid()) = user_id);
