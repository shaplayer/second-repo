-- One picks table for both old systems (plan 1.6b): the app's picks, plus the data site's pick alerts
-- copied in as send history. Picks are still never deleted, and a sponsored pick must still say who paid.
alter table public.picks
  alter column price_at_post drop not null,   -- optional now: typed in by staff, never taken from a price feed
  alter column owns_shares drop not null,     -- unknown for history copied from the data site
  add column cik bigint references public.companies (cik),
  add column disclosure_text text,            -- the sponsor disclosure exactly as it was sent (data-site history)
  add column imported_from text,              -- 'data-site:alerts' for copied history; empty for picks made here
  add column legacy_id text,
  add column legacy jsonb;                    -- the old row, so nothing recorded at send time is lost

create unique index picks_import_key on public.picks (imported_from, legacy_id) where imported_from is not null;
create index picks_company on public.picks (cik) where cik is not null;

-- Section 17(b): a sponsored post names who paid, how much and in what form. History copied from the data
-- site recorded that as one sentence, which is kept word for word in disclosure_text.
alter table public.picks drop constraint sponsored_needs_disclosure;
alter table public.picks add constraint sponsored_needs_disclosure check (
  kind = 'pick'
  or (
    sponsor is not null
    and coalesce(sponsor->>'payer', '') <> ''
    and coalesce(sponsor->>'amount', '') <> ''
    and coalesce(sponsor->>'form', '') <> ''
  )
  or (imported_from is not null and coalesce(btrim(disclosure_text), '') <> '')
);
