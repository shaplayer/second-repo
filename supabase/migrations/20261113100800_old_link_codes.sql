-- Two fixes found when the copy from the old sites was reviewed.

-- 1. Every code that appears in a link the old sites already emailed must still find its row. When
--    one person was on both old sites, their two old records become one row here, and the codes of
--    BOTH records have to keep working. They are kept in this list; the unsubscribe and confirm
--    pages look here as well as at the row's own codes.
alter table public.alert_subscriptions add column legacy_tokens text[] not null default '{}';
create index alert_subscriptions_legacy_tokens on public.alert_subscriptions using gin (legacy_tokens);

-- 2. "updated_at = backfilled_at" means "the person has not changed this row on the new site".
--    Tying a row to an account when its owner signs in, and counting confirmation emails, are not
--    changes by the person, so they no longer move updated_at. Without this, simply signing in made
--    every one of a person's rows look changed, and an opt-out made on an old site afterwards was
--    never applied to them.
create function public.alert_subscriptions_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'user_id' - 'confirm_sent_at' - 'confirm_sends' - 'updated_at')
     is distinct from (to_jsonb(old) - 'user_id' - 'confirm_sent_at' - 'confirm_sends' - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.alert_subscriptions_touch() from public, anon, authenticated;

drop trigger alert_subscriptions_touch on public.alert_subscriptions;
create trigger alert_subscriptions_touch
  before update on public.alert_subscriptions
  for each row execute function public.alert_subscriptions_touch();
