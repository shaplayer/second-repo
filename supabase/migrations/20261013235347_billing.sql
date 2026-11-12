-- Stripe links. Only the server writes these (from Stripe's own data), so users can't grant themselves membership.
alter table public.profiles
  add column stripe_customer_id text unique,
  add column subscription_status text,
  add column subscription_interval text,
  add column cancel_at_period_end boolean not null default false,
  add column trial_used boolean not null default false;
