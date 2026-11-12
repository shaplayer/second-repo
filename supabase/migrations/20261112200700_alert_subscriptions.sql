-- Who gets which alerts. One row per address, per channel, per company; cik empty = the general list
-- (free picks). Email only for now; the sms channel is kept so text alerts can be added later and so the
-- consent records of people who signed up for texts on the old site are preserved.
--
-- status: pending = asked, not confirmed yet (double opt-in); active = may be sent to;
--         unsubscribed = never send. Alerts go only to rows that are active.
create table public.alert_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid references public.users (id) on delete set null,   -- empty for sign-ups without an account
  channel text not null check (channel in ('email', 'sms')),
  address text not null,                                           -- email (lower case), or phone as +15555550123
  cik bigint references public.companies (cik),                    -- empty = general list
  categories text[] not null default '{press,earnings,news,insider}'
    check (categories <@ array['picks', 'press', 'earnings', 'news', 'insider', 'ipo', 'proxy']::text[]),
  cadence text not null default 'instant' check (cadence in ('instant', 'digest')),
  status text not null default 'pending' check (status in ('pending', 'active', 'unsubscribed')),
  confirm_token text unique check (confirm_token ~ '^[A-Za-z0-9_-]{20,64}$'),
  unsubscribe_token text not null unique check (unsubscribe_token ~ '^[A-Za-z0-9_-]{20,64}$'),
  legacy_token text,               -- the token used in links already sent by the old sites, so those links keep working
  -- Consent evidence. Stored exactly as recorded and never rewritten (TCPA).
  consent_text text,
  consent_at timestamptz,
  consent_ip text,
  consent_user_agent text,
  source text,                     -- the page or form the sign-up came from
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  backfilled_at timestamptz,       -- set by the migration scripts; equal to updated_at until the new site changes the row
  legacy jsonb,                    -- which old table and row this came from
  constraint alert_subscriptions_one_per_address_and_company unique nulls not distinct (channel, address, cik),
  constraint alert_subscriptions_address_shape check (
    (channel = 'email' and address = lower(address) and address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')
    or (channel = 'sms' and address ~ '^\+[1-9][0-9]{6,14}$')
  )
);
create index alert_subscriptions_company_active on public.alert_subscriptions (cik) where status = 'active';
create index alert_subscriptions_address on public.alert_subscriptions (address);
create index alert_subscriptions_user on public.alert_subscriptions (user_id) where user_id is not null;
create index alert_subscriptions_legacy_token on public.alert_subscriptions (legacy_token) where legacy_token is not null;

-- updated_at always moves when a row changes. The migration scripts set backfilled_at in the same
-- statement, so "updated_at = backfilled_at" means "untouched since it was migrated" and such a row may
-- be refreshed by running the scripts again; anything the new site has changed is left alone.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create trigger alert_subscriptions_touch
  before update on public.alert_subscriptions
  for each row execute function public.touch_updated_at();

alter table public.alert_subscriptions enable row level security;

-- A signed-in person may see their own subscriptions, but never the link tokens or the consent evidence.
revoke all on public.alert_subscriptions from anon, authenticated;
grant select (id, user_id, channel, address, cik, categories, cadence, status, created_at)
  on public.alert_subscriptions to authenticated;
create policy "Users can read their own alert subscriptions"
  on public.alert_subscriptions for select to authenticated
  using (user_id is not null and (select auth.uid()) = user_id);
