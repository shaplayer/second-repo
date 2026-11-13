-- One confirmation click confirms everything the person asked for in that sign-up, and nothing else.
-- Rows created by the same sign-up share a batch code; a confirmation link only switches on the rows
-- of its own batch, so a stranger cannot slip extra stocks into someone else's confirmation.
alter table public.alert_subscriptions add column confirm_batch text;
create index alert_subscriptions_batch on public.alert_subscriptions (confirm_batch) where confirm_batch is not null;
