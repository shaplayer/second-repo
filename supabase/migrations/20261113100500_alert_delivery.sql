-- Sending: addresses that must never be sent to again, daily summaries, and the small counters that
-- stop the sign-up forms from being used to flood someone's inbox.

-- An address the email service told us to stop using (it bounced, or the person pressed "spam"), or
-- that staff blocked by hand. Checked before every send, whatever the subscription says.
create table public.suppressions (
  channel text not null check (channel in ('email', 'sms')),
  address text not null,
  reason text not null check (reason in ('bounce', 'complaint', 'manual', 'stop')),
  detail jsonb,
  created_at timestamptz not null default now(),
  primary key (channel, address)
);

-- One row per daily summary email (people who chose "one daily summary").
create table public.digests (
  id bigint generated always as identity primary key,
  channel text not null default 'email' check (channel in ('email')),
  address text not null,
  item_count int not null check (item_count > 0),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index digests_address on public.digests (address, created_at desc);
alter table public.alert_events
  add constraint alert_events_digest_fkey foreign key (digest_id) references public.digests (id);
create index alert_events_sending on public.alert_events (next_attempt_at) where status = 'sending';

-- How many confirmation emails a sign-up has been sent, and when the last one went.
alter table public.alert_subscriptions
  add column confirm_sent_at timestamptz,
  add column confirm_sends int not null default 0;

-- Counters for "at most N of these per hour from one address or one visitor".
create table public.rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (bucket, key, window_start)
);
create index rate_limits_old on public.rate_limits (window_start);

alter table public.suppressions enable row level security;
alter table public.digests enable row level security;
alter table public.rate_limits enable row level security;
