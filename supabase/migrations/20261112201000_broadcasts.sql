-- One row per list-wide send of a pick. The sender works through the list in batches and can pick up
-- where it stopped. Moved here from the data site's own database.
create table public.broadcasts (
  id bigint generated always as identity primary key,
  pick_id uuid references public.picks (id),
  channels text[] not null check (cardinality(channels) > 0 and channels <@ array['email', 'sms']::text[]),
  subject text not null,
  text_body text not null,
  html_body text not null,
  sms_body text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sending', 'done', 'failed')),
  email_cursor bigint not null default 0,
  sms_cursor bigint not null default 0,
  emails_sent int not null default 0,
  texts_sent int not null default 0,
  failed int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  imported_from text,
  legacy_id text,
  legacy jsonb
);
create unique index broadcasts_import_key on public.broadcasts (imported_from, legacy_id) where imported_from is not null;
create index broadcasts_open on public.broadcasts (id) where status in ('queued', 'sending');

alter table public.broadcasts enable row level security;
