-- Every alert owed to every subscriber: the send queue, the "never twice" rule and the delivery log in
-- one table. One row per subscription per item, so "did this person get that alert, and when?" always
-- has an answer, and a restart in the middle of a send can neither skip nor repeat anyone.
create table public.alert_events (
  id bigint generated always as identity primary key,
  subscription_id bigint not null references public.alert_subscriptions (id),
  item_type text not null check (item_type in ('filing', 'news', 'pick')),
  item_ref text not null,                       -- accession number, news id or pick id
  dedupe_key text not null,                     -- e.g. filing:0000320193-26-000018
  status text not null default 'queued'
    check (status in ('queued', 'digest', 'sending', 'sent', 'failed', 'suppressed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  digest_id bigint,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint alert_events_once_per_person_per_item unique (subscription_id, dedupe_key)
);
create index alert_events_queue on public.alert_events (next_attempt_at) where status = 'queued';
create index alert_events_digest on public.alert_events (subscription_id) where status = 'digest';
create index alert_events_item on public.alert_events (item_type, item_ref);

alter table public.alert_events enable row level security;
