-- What the stock page shows about a company, read from the SEC's own record of it, and the marks the
-- worker uses to decide which companies to look at next.
alter table public.companies
  add column city text,
  add column state text,
  add column filer_category text,           -- the SEC's line, e.g. "Non-accelerated filer | Emerging growth company"
  add column profile_checked_at timestamptz, -- when the SEC's record of the company and its recent filings were last read
  add column facts_checked_at timestamptz,   -- when its financial numbers were last read (the health check)
  add column viewed_at timestamptz;          -- last time someone opened its page; keeps it on the nightly list

-- "Which tracked company has waited longest?" for the two worker jobs.
create index companies_profile_todo on public.companies (profile_checked_at nulls first) where tracked;
create index companies_facts_todo on public.companies (facts_checked_at nulls first) where tracked;
