-- Messages from the "For public companies" form. Moved here from the data site's own database.
create table public.inquiries (
  id bigint generated always as identity primary key,
  name text not null,
  company text not null,
  ticker text,
  email text not null,
  phone text,
  package text,
  message text,
  ip text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  notified_at timestamptz,      -- when the team was emailed about it (empty = not sent yet)
  imported_from text,
  legacy_id text
);
create unique index inquiries_import_key on public.inquiries (imported_from, legacy_id) where imported_from is not null;
create index inquiries_newest on public.inquiries (created_at desc);

alter table public.inquiries enable row level security;
