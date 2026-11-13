/**
 * The sender: turns queued alert_events into emails (plan Phase 4, steps 2 and 3).
 *
 * What it guarantees:
 * - Only a subscription that is 'active' at the moment of sending is sent to. If the person has
 *   unsubscribed, or the email service told us to stop using the address, the event is marked
 *   'suppressed' instead.
 * - An event is sent at most once. It is claimed ('sending') before the email service is called, and
 *   the call carries a key so a retry after an unclear failure cannot produce a second email.
 * - A failure is retried later (after 1, 5, 15 and 60 minutes), then marked 'failed' with the reason.
 * - Alert emails are not sent at all until the business postal address is set (the law requires it
 *   in every such email).
 * - Insider trades from one company that arrive together go out as one email. Every insider-trade
 *   alert waits a few minutes to see whether others follow; three or more for the same follower
 *   become one email, fewer go out one by one. Trades on different days are never merged.
 * - Email only. Nothing here can send a text.
 */
import { createHash } from "node:crypto";
import type { Client, Pool, PoolClient } from "pg";
import { postalAddress, siteUrl } from "../config";
import { getFeedItem, type FeedItem } from "../data/feed";
import { getPick, type StockPick } from "../data/picks";
import { emailProvider, type EmailMessage, type EmailProvider } from "../email";
import { inTransaction } from "./subscriptions";
import { alertEmail, digestEmail, insiderBurstEmail, pickEmail, type EmailParts, type Footer } from "./templates";

type Db = Pool | PoolClient | Client;

export const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 15, 60];
/** How long an alert waits for its plain-English summary before going out without one. */
export const SUMMARY_WAIT_SECONDS = 90;
/** An alert that could not be sent within this many hours is dropped, never sent late. */
export const STALE_AFTER_HOURS = 6;
/** How long an insider-trade alert waits for others from the same company before it is sent. */
export const INSIDER_HOLD_SECONDS = 300;
/** This many insider trades for one follower at once become one email; fewer are sent one by one. */
export const BURST_MIN = 3;

export type SendResult = { sent: number; failed: number; retrying: number; suppressed: number };
export type SendOptions = { provider?: EmailProvider; limit?: number };

type Claimed = {
  id: string; subscription_id: string; item_type: "filing" | "news" | "pick"; item_ref: string; attempts: number;
  status: string; address: string; unsubscribe_token: string; cik: string | null; suppressed: boolean;
  /** Set when this alert was put into a combined email on an earlier try: it is retried with the same ones. */
  batch_key: string | null;
};

function requireAddress(provider: EmailProvider): string | null {
  const address = postalAddress();
  // The console provider only prints: fine for development without an address.
  if (!address && provider.name !== "console") {
    throw new Error("COMPANY_POSTAL_ADDRESS is not set. Alert emails must carry the business postal address, so none were sent.");
  }
  return address;
}

function footerFor(row: { unsubscribe_token: string; cik: string | null }, address: string | null, reason: string, scope?: string): Footer {
  const site = siteUrl();
  const token = encodeURIComponent(row.unsubscribe_token);
  return {
    siteUrl: site, postalAddress: address, reason,
    unsubscribeUrl: `${site}/unsubscribe?token=${token}`,
    oneClickUrl: `${site}/api/unsubscribe?token=${token}${scope ? `&scope=${scope}` : ""}`,
  };
}

const toMessage = (to: string, p: EmailParts): EmailMessage => ({ to: [to], subject: p.subject, text: p.text, html: p.html, headers: p.headers });

async function markSent(db: Db, ids: string[], providerIds: string[] = []): Promise<void> {
  if (!ids.length) return;
  await db.query(
    `update public.alert_events e set status = 'sent', sent_at = now(), error = null, provider_message_id = x.pid
       from unnest($1::bigint[], $2::text[]) as x(id, pid) where e.id = x.id`,
    [ids, ids.map((_, i) => providerIds[i] || null)],
  );
}

/** Puts failed events back in the queue for later, or gives up after MAX_ATTEMPTS. Returns how many were given up on. */
async function markFailed(db: Db, events: { id: string; attempts: number }[], error: string): Promise<number> {
  let gaveUp = 0;
  for (const e of events) {
    const final = e.attempts >= MAX_ATTEMPTS;
    if (final) gaveUp++;
    await db.query(
      `update public.alert_events set status = $2, error = $3, next_attempt_at = now() + make_interval(mins => $4) where id = $1`,
      [e.id, final ? "failed" : "queued", error.slice(0, 500), RETRY_MINUTES[Math.min(e.attempts - 1, RETRY_MINUTES.length - 1)] ?? 60],
    );
  }
  return gaveUp;
}

/**
 * Sends one batch of queued alerts. Call it again while it reports work done.
 * Throws only for a set-up problem that stops all sending (no postal address, email service not set up).
 */
export async function sendQueuedAlerts(db: Db, opts: SendOptions = {}): Promise<SendResult> {
  const provider = opts.provider ?? emailProvider();
  const result: SendResult = { sent: 0, failed: 0, retrying: 0, suppressed: 0 };
  if (!provider.configured()) throw new Error(`The email service "${provider.name}" is not set up, so no alerts were sent.`);
  const address = requireAddress(provider);

  // Something claimed these and never finished (a crash mid-send): try them again. The key on the send stops a second email.
  await db.query(`update public.alert_events set status = 'queued' where status = 'sending' and next_attempt_at <= now()`);
  // News that has waited too long is no longer an alert (sending was switched off for a while, or the worker was down):
  // it is dropped rather than sent late in a burst.
  await db.query(
    `update public.alert_events set status = 'suppressed', error = 'too old to send'
      where status = 'queued' and created_at < now() - make_interval(hours => $1)`,
    [STALE_AFTER_HOURS],
  );

  const claimed = await inTransaction(db, async (c) => {
    const { rows } = await c.query<Claimed>(
      `with picked as (
         select e.id from public.alert_events e
          where e.status = 'queued' and e.next_attempt_at <= now()
            -- Give the summary a moment to be written, so the email can carry it.
            and not (e.item_type in ('filing', 'news') and e.created_at > now() - make_interval(secs => $2)
                     and exists (select 1 from public.summary_jobs j
                                  where j.status in ('queued', 'working')
                                    and ((e.item_type = 'filing' and j.accession = e.item_ref)
                                      or (e.item_type = 'news' and j.news_id::text = e.item_ref))))
            -- An insider trade waits a few minutes, so that a burst from one company can go out as one email.
            and not (e.item_type = 'filing' and e.batch_key is null and e.created_at > now() - make_interval(secs => $3)
                     and exists (select 1 from public.filings f where f.accession = e.item_ref and f.category = 'insider'))
          order by e.next_attempt_at, e.id
          limit $1
            for update skip locked
       ),
       -- An email that is being retried is retried whole: bring in the rest of its alerts.
       whole as (
         select id from picked
         union
         select e.id from public.alert_events e
          where e.status = 'queued'
            and e.batch_key in (select b.batch_key from public.alert_events b join picked p on p.id = b.id where b.batch_key is not null)
       )
       update public.alert_events e
          set status = 'sending', attempts = e.attempts + 1, next_attempt_at = now() + interval '10 minutes'
         from whole p, public.alert_subscriptions s
        where e.id = p.id and s.id = e.subscription_id
        returning e.id::text as id, e.subscription_id::text as subscription_id, e.item_type, e.item_ref, e.attempts,
                  s.status, s.address, s.unsubscribe_token, s.cik::text as cik, e.batch_key,
                  (s.channel <> 'email' or exists (select 1 from public.suppressions x where x.channel = s.channel and x.address = s.address)) as suppressed`,
      [Math.min(Math.max(opts.limit ?? 500, 1), 2000), SUMMARY_WAIT_SECONDS, INSIDER_HOLD_SECONDS],
    );
    return rows;
  });
  if (!claimed.length) return result;

  // Never send unless the subscription is active right now.
  const blocked = claimed.filter((e) => e.status !== "active" || e.suppressed);
  if (blocked.length) {
    await db.query(
      `update public.alert_events set status = 'suppressed', error = 'not an active subscription at send time' where id = any($1::bigint[])`,
      [blocked.map((e) => e.id)],
    );
    result.suppressed += blocked.length;
  }
  const ready = claimed.filter((e) => e.status === "active" && !e.suppressed);

  // Load each item once, however many people it goes to.
  const items = new Map<string, FeedItem | StockPick | null>();
  for (const e of ready) {
    const key = `${e.item_type}:${e.item_ref}`;
    if (items.has(key)) continue;
    items.set(
      key,
      e.item_type === "pick" ? await getPick(db, e.item_ref)
        : await getFeedItem(db, `${e.item_type === "filing" ? "f" : "n"}:${e.item_ref}`),
    );
  }

  const present: Claimed[] = [];
  for (const e of ready) {
    if (items.get(`${e.item_type}:${e.item_ref}`)) {
      present.push(e);
      continue;
    }
    await db.query(`update public.alert_events set status = 'failed', error = 'the item no longer exists' where id = $1`, [e.id]);
    result.failed++;
  }

  // Insider trades for the same follower that arrived together: one email for all of them.
  const isInsider = (e: Claimed) => e.item_type === "filing" && (items.get(`filing:${e.item_ref}`) as FeedItem).category === "insider";
  const bursts = new Map<string, Claimed[]>();
  const fresh = new Map<string, Claimed[]>();
  for (const e of present) {
    if (e.batch_key) bursts.set(e.batch_key, [...(bursts.get(e.batch_key) ?? []), e]);
    else if (isInsider(e)) fresh.set(e.subscription_id, [...(fresh.get(e.subscription_id) ?? []), e]);
  }
  for (const [subscription, events] of fresh) {
    if (events.length < BURST_MIN) continue;
    const key = `burst:${subscription}:${events.map((e) => Number(e.id)).sort((a, b) => a - b)[0]}`;
    // Recorded before the send, so that whatever happens next these alerts stay together.
    await db.query(`update public.alert_events set batch_key = $2 where id = any($1::bigint[])`, [events.map((e) => e.id), key]);
    for (const e of events) e.batch_key = key;
    bursts.set(key, events);
  }
  for (const [key, events] of bursts) {
    const first = events[0];
    const feed = events
      .map((e) => items.get(`${e.item_type}:${e.item_ref}`) as FeedItem)
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
    const reason = `You're getting this because you asked for alerts on ${feed[0].ticker ? `$${feed[0].ticker}` : feed[0].company}.`;
    const message = toMessage(first.address, insiderBurstEmail({ items: feed, footer: footerFor(first, address, reason) }));
    try {
      const out = await provider.send(message, { idempotencyKey: "bs-burst-" + createHash("sha256").update(key).digest("hex").slice(0, 40) });
      await markSent(db, events.map((e) => e.id), events.map(() => out.id));
      result.sent += events.length;
    } catch (err) {
      const gaveUp = await markFailed(db, events, (err as Error).message);
      result.failed += gaveUp;
      result.retrying += events.length - gaveUp;
    }
  }

  const groups = new Map<string, Claimed[]>();
  for (const e of present) {
    if (e.batch_key) continue; // went out above, in a combined email
    const key = `${e.item_type}:${e.item_ref}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  for (const [key, events] of groups) {
    const item = items.get(key)!;
    const messages = events.map((e) => {
      if (e.item_type === "pick") {
        const reason = e.cik === null ? "You're getting this because you asked for the free BigStocks pick." : "You're getting this because you follow this company on BigStocks.";
        return toMessage(e.address, pickEmail({ pick: item as StockPick, footer: footerFor(e, address, reason) }));
      }
      const it = item as FeedItem;
      const reason = `You're getting this because you asked for alerts on ${it.ticker ? `$${it.ticker}` : it.company}.`;
      return toMessage(e.address, alertEmail({ item: it, footer: footerFor(e, address, reason) }));
    });
    for (let i = 0; i < events.length; i += 100) {
      const part = events.slice(i, i + 100);
      const msgs = messages.slice(i, i + 100);
      try {
        if (provider.sendBatch && part.length > 1) {
          const key2 = "bs-batch-" + createHash("sha256").update(part.map((e) => `${e.id}.${e.attempts}`).join(",")).digest("hex").slice(0, 40);
          const out = await provider.sendBatch(msgs, { idempotencyKey: key2 });
          await markSent(db, part.map((e) => e.id), out?.ids ?? []);
          result.sent += part.length;
        } else {
          for (let k = 0; k < part.length; k++) {
            try {
              const out = await provider.send(msgs[k], { idempotencyKey: `bs-alert-${part[k].id}` });
              await markSent(db, [part[k].id], [out.id]);
              result.sent++;
            } catch (err) {
              const gaveUp = await markFailed(db, [part[k]], (err as Error).message);
              result.failed += gaveUp;
              result.retrying += 1 - gaveUp;
            }
          }
        }
      } catch (err) {
        const gaveUp = await markFailed(db, part, (err as Error).message);
        result.failed += gaveUp;
        result.retrying += part.length - gaveUp;
      }
    }
  }
  return result;
}

/**
 * Sends the daily summary to everyone who chose "one daily summary" and has something waiting: one
 * email per address with all of the day's items. The worker calls this at 6:00 PM New York time.
 */
export async function sendDigests(db: Db, opts: SendOptions = {}): Promise<SendResult> {
  const provider = opts.provider ?? emailProvider();
  const result: SendResult = { sent: 0, failed: 0, retrying: 0, suppressed: 0 };
  if (!provider.configured()) throw new Error(`The email service "${provider.name}" is not set up, so no daily summaries were sent.`);
  const address = requireAddress(provider);

  const { rows: people } = await db.query<{ address: string }>(
    `select distinct s.address
       from public.alert_events e join public.alert_subscriptions s on s.id = e.subscription_id
      where e.status = 'digest' and s.channel = 'email'
      order by s.address limit $1`,
    [Math.min(Math.max(opts.limit ?? 500, 1), 5000)],
  );

  for (const person of people) {
    await inTransaction(db, async (c) => {
      const { rows } = await c.query<{ id: string; item_type: "filing" | "news"; item_ref: string; status: string; unsubscribe_token: string; cik: string | null; suppressed: boolean }>(
        `select e.id::text as id, e.item_type, e.item_ref, s.status, s.unsubscribe_token, s.cik::text as cik,
                exists (select 1 from public.suppressions x where x.channel = 'email' and x.address = s.address) as suppressed
           from public.alert_events e join public.alert_subscriptions s on s.id = e.subscription_id
          where e.status = 'digest' and s.channel = 'email' and s.address = $1
          order by e.created_at, e.id
            for update of e skip locked`,
        [person.address],
      );
      const blocked = rows.filter((r) => r.status !== "active" || r.suppressed);
      if (blocked.length) {
        await c.query(
          `update public.alert_events set status = 'suppressed', error = 'not an active subscription at send time' where id = any($1::bigint[])`,
          [blocked.map((r) => r.id)],
        );
        result.suppressed += blocked.length;
      }
      const ready = rows.filter((r) => r.status === "active" && !r.suppressed);
      if (!ready.length) return;
      const feed: FeedItem[] = [];
      for (const r of ready.slice(0, 40)) {
        const it = await getFeedItem(c, `${r.item_type === "filing" ? "f" : "n"}:${r.item_ref}`);
        if (it) feed.push(it);
      }
      if (!feed.length) {
        await c.query(`update public.alert_events set status = 'failed', error = 'the items no longer exist' where id = any($1::bigint[])`, [ready.map((r) => r.id)]);
        result.failed += ready.length;
        return;
      }
      const digest = await c.query<{ id: string }>(
        `insert into public.digests (address, item_count) values ($1, $2) returning id::text as id`,
        [person.address, feed.length],
      );
      const digestId = digest.rows[0].id;
      const footer = footerFor(ready[0], address, "You're getting this because you chose one daily summary of your BigStocks alerts.", "stocks");
      try {
        const out = await provider.send(toMessage(person.address, digestEmail({ items: feed, footer })), { idempotencyKey: `bs-digest-${digestId}` });
        await c.query(`update public.digests set status = 'sent', sent_at = now(), provider_message_id = $2 where id = $1`, [digestId, out.id || null]);
        await c.query(
          `update public.alert_events set status = 'sent', sent_at = now(), digest_id = $2, attempts = attempts + 1 where id = any($1::bigint[])`,
          [ready.map((r) => r.id), digestId],
        );
        result.sent += 1;
      } catch (err) {
        // Leave the events waiting: they go out with the next summary. Keep a record of the failure.
        await c.query(`update public.digests set status = 'failed', error = $2 where id = $1`, [digestId, (err as Error).message.slice(0, 500)]);
        result.retrying += 1;
      }
    });
  }
  return result;
}
