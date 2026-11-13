/**
 * The matcher: for each new filing, press release or pick, makes one alert_events row for every active
 * email subscription that asked for it (plan Phase 4, step 1).
 *
 * - It runs the moment an item is stored, before any summary exists.
 * - One row per person per item, ever: the database's unique rule makes a double send impossible even
 *   if the worker restarts in the middle.
 * - Only subscriptions whose status is 'active' are matched. Pending and unsubscribed rows never are.
 * - Old items are never alerted on: anything older than MAX_ALERT_AGE_HOURS (history copied from the
 *   old sites, or a backlog after downtime) is marked as handled without making alerts.
 * - Email only. Rows with channel 'sms' are not matched.
 */
import type { Client, Pool, PoolClient } from "pg";
import { inTransaction } from "./subscriptions";

type Db = Pool | PoolClient | Client;

export const MAX_ALERT_AGE_HOURS = 24;

export type MatchResult = { filings: number; releases: number; picks: number; events: number };

async function matchFilings(db: Db, limit: number): Promise<{ items: number; events: number }> {
  return inTransaction(db, async (c) => {
    const { rows } = await c.query<{ items: string; events: string }>(
      `with todo as (
         select f.accession, f.cik, f.form, f.category, f.accepted_at
           from public.filings f
          where f.matched_at is null
            -- A filing the worker has not classified yet gets an hour's grace; after that it is skipped for good.
            and (f.category is not null or f.ingested_at < now() - interval '1 hour')
          order by f.accepted_at
          limit $1
            for update skip locked
       ), made as (
         insert into public.alert_events (subscription_id, item_type, item_ref, dedupe_key, status)
         select s.id, 'filing', t.accession, 'filing:' || t.accession, case when s.cadence = 'digest' then 'digest' else 'queued' end
           from todo t
           join public.alert_subscriptions s on s.cik = t.cik
          where t.category is not null
            and t.accepted_at > now() - make_interval(hours => $2)
            and s.status = 'active' and s.channel = 'email' and t.category = any(s.categories)
         on conflict on constraint alert_events_once_per_person_per_item do nothing
         returning item_ref
       ), jobs as (
         -- A company with subscribers posted something: put it on the summary list (insider trades are summarised without AI).
         insert into public.summary_jobs (accession, reason)
         select distinct m.item_ref, 'subscribed'
           from made m join todo t on t.accession = m.item_ref
          where t.form not in ('4', '4/A')
            and not exists (select 1 from public.summaries x where x.accession = m.item_ref)
         on conflict do nothing
       ), marked as (
         update public.filings f set matched_at = now() from todo t where f.accession = t.accession returning 1
       )
       select (select count(*) from marked) as items, (select count(*) from made) as events`,
      [limit, MAX_ALERT_AGE_HOURS],
    );
    return { items: Number(rows[0].items), events: Number(rows[0].events) };
  });
}

async function matchReleases(db: Db, limit: number): Promise<{ items: number; events: number }> {
  return inTransaction(db, async (c) => {
    const { rows } = await c.query<{ items: string; events: string }>(
      `with todo as (
         select n.id, n.cik, n.source, n.published_at
           from public.news n
          where n.matched_at is null
          order by n.published_at
          limit $1
            for update skip locked
       ), made as (
         -- A release attached to a filing (source 'sec') is part of that filing's alert, never its own.
         insert into public.alert_events (subscription_id, item_type, item_ref, dedupe_key, status)
         select s.id, 'news', t.id::text, 'news:' || t.id, case when s.cadence = 'digest' then 'digest' else 'queued' end
           from todo t
           join public.alert_subscriptions s on s.cik = t.cik
          where t.source <> 'sec' and t.cik is not null
            and t.published_at > now() - make_interval(hours => $2)
            and s.status = 'active' and s.channel = 'email' and 'press' = any(s.categories)
         on conflict on constraint alert_events_once_per_person_per_item do nothing
         returning item_ref
       ), jobs as (
         insert into public.summary_jobs (news_id, reason)
         select distinct t.id, 'subscribed'
           from made m join todo t on t.id::text = m.item_ref
           join public.news_sources src on src.key = t.source
          where src.can_summarize
            and not exists (select 1 from public.summaries x where x.news_id = t.id)
         on conflict do nothing
       ), marked as (
         update public.news n set matched_at = now() from todo t where n.id = t.id returning 1
       )
       select (select count(*) from marked) as items, (select count(*) from made) as events`,
      [limit, MAX_ALERT_AGE_HOURS],
    );
    return { items: Number(rows[0].items), events: Number(rows[0].events) };
  });
}

async function matchPicks(db: Db): Promise<{ items: number; events: number }> {
  return inTransaction(db, async (c) => {
    const { rows } = await c.query<{ items: string; events: string }>(
      `with todo as (
         select p.id, p.cik, p.posted_at
           from public.picks p
          where p.matched_at is null and p.imported_from is null
          order by p.posted_at
          limit 5
            for update skip locked
       ), made as (
         -- Everyone on the free pick list, plus anyone who asked for picks about this company. One email
         -- per address, and always at once: the pick is not held for the daily summary.
         insert into public.alert_events (subscription_id, item_type, item_ref, dedupe_key, status)
         select distinct on (t.id, s.address) s.id, 'pick', t.id::text, 'pick:' || t.id, 'queued'
           from todo t
           join public.alert_subscriptions s on (s.cik is null or s.cik = t.cik)
          where t.posted_at > now() - make_interval(hours => $1)
            and s.status = 'active' and s.channel = 'email' and 'picks' = any(s.categories)
          order by t.id, s.address, (s.cik is null) desc, s.id
         on conflict on constraint alert_events_once_per_person_per_item do nothing
         returning 1
       ), marked as (
         update public.picks p set matched_at = now() from todo t where p.id = t.id returning 1
       )
       select (select count(*) from marked) as items, (select count(*) from made) as events`,
      [MAX_ALERT_AGE_HOURS],
    );
    return { items: Number(rows[0].items), events: Number(rows[0].events) };
  });
}

/** One pass over everything not yet matched. Call it again while it keeps finding items. */
export async function matchNewItems(db: Db, limit = 500): Promise<MatchResult> {
  const f = await matchFilings(db, limit);
  const n = await matchReleases(db, limit);
  const p = await matchPicks(db);
  return { filings: f.items, releases: n.items, picks: p.items, events: f.events + n.events + p.events };
}
