-- Test emails are separate from public picks and normal alert history.
create table public.test_alerts (
  id bigint generated always as identity primary key,
  created_by uuid not null references public.users (id),
  subject text not null,
  body text not null,
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table public.test_alert_recipients (
  id bigint generated always as identity primary key,
  delivery_key uuid not null default gen_random_uuid() unique,
  test_alert_id bigint not null references public.test_alerts (id),
  subscription_id bigint not null references public.alert_subscriptions (id),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'suppressed', 'failed', 'cancelled')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  error text,
  unique (test_alert_id, subscription_id)
);
create index test_alert_recipients_queue on public.test_alert_recipients (next_attempt_at) where status in ('queued', 'sending');

alter table public.test_alerts enable row level security;
alter table public.test_alert_recipients enable row level security;
revoke all on public.test_alerts, public.test_alert_recipients from anon, authenticated;
revoke all on sequence public.test_alerts_id_seq, public.test_alert_recipients_id_seq from anon, authenticated;
