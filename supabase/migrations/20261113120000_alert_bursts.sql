-- Several insiders at one company often report their trades within minutes of each other. A follower
-- gets those as one email, not one email each (owner's decision, Nov 13, 2026). Alerts that go out
-- together in one email share a batch key, so that a retry after a failed send sends the very same
-- email again and can never produce a second one.
alter table public.alert_events add column batch_key text;
create index alert_events_batch on public.alert_events (batch_key) where batch_key is not null;
