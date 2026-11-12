-- Remove the test row inserted while checking this rule (deletes are normally blocked).
alter table public.picks disable trigger picks_no_delete;
delete from public.picks where kind = 'sponsored' and title = 'test' and why = 'w' and company_name = 'Ford' and sponsor is null;
alter table public.picks enable trigger picks_no_delete;

-- A missing disclosure (NULL) must fail the check too, not slip through as "unknown".
alter table public.picks drop constraint sponsored_needs_disclosure;
alter table public.picks add constraint sponsored_needs_disclosure check (
  kind = 'pick'
  or (
    sponsor is not null
    and coalesce(sponsor->>'payer', '') <> ''
    and coalesce(sponsor->>'amount', '') <> ''
    and coalesce(sponsor->>'form', '') <> ''
  )
);
