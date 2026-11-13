-- The new tables are read and written by our server only (lib/db.ts). This file removes what was left
-- over from the earlier plan to sign people in with Supabase Auth, so that nothing outside our server
-- can reach them, whatever the project's default grants or sign-up settings are.

-- 1. "Read your own rows" policies. The site never uses them (it signs people in itself and reads
--    through the server), and anyone who can get a Supabase Auth token could have used them.
drop policy "Users can read their own account" on public.users;
drop policy "Users can read their own stocks" on public.watchlists;
drop policy "Users can read their own alert subscriptions" on public.alert_subscriptions;

-- 2. No table rights at all for the two public roles on the new tables. Row-level security already
--    hides the rows; this also covers what row-level security does not (emptying a table), and holds
--    after a backup is restored without its grants.
do $$
declare
  t text;
  s text;
begin
  foreach t in array array[
    'alert_events', 'alert_subscriptions', 'backfill_runs', 'broadcasts', 'companies', 'company_tickers',
    'digests', 'filings', 'fundamentals_snapshots', 'inquiries', 'job_state', 'login_tokens', 'news',
    'news_sources', 'rate_limits', 'sessions', 'summaries', 'summary_jobs', 'suppressions', 'users', 'watchlists'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    for s in
      select c.relname from pg_class c
        join pg_depend d on d.objid = c.oid and d.deptype in ('a', 'i')
        join pg_class owner on owner.oid = d.refobjid
       where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace
         and owner.relnamespace = 'public'::regnamespace and owner.relname = t
    loop
      execute format('revoke all on sequence public.%I from anon, authenticated', s);
    end loop;
  end loop;
end;
$$;

-- 3. A sponsored pick must say who paid, how much and in what form. The one exception is history copied
--    from the old data site, which recorded that as a single sentence: name that source exactly, so no
--    other kind of import can skip the three fields.
alter table public.picks drop constraint sponsored_needs_disclosure;
alter table public.picks add constraint sponsored_needs_disclosure check (
  kind = 'pick'
  or (
    sponsor is not null
    and coalesce(sponsor->>'payer', '') <> ''
    and coalesce(sponsor->>'amount', '') <> ''
    and coalesce(sponsor->>'form', '') <> ''
  )
  or (coalesce(imported_from, '') = 'data-site:alerts' and coalesce(btrim(disclosure_text), '') <> '')
);

-- 4. Blocked addresses are stored in lower case, as the code already writes them, so a check for a
--    blocked address can never miss because of a capital letter.
alter table public.suppressions add constraint suppressions_address_lower check (address = lower(address));

-- 5. No longer used: alert_subscriptions has its own function since 20261113100800.
drop function public.touch_updated_at();
