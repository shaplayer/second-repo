import type { Client, Pool, PoolClient } from "pg";
import { postalAddress, siteUrl } from "../config";
import { emailProvider, type EmailProvider } from "../email";
import { inTransaction } from "./subscriptions";
import { testAlertEmail } from "./templates";

type Db = Pool | PoolClient | Client;
const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 15, 60];

export class TestAlertInputError extends Error {}

export async function searchTestRecipients(db: Db, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 2 || q.length > 254) return [];
  const { rows } = await db.query<{ id: string; address: string }>(
    `select s.id::text as id, s.address from public.alert_subscriptions s
      where s.channel = 'email' and s.status = 'active' and s.cik is null and 'picks' = any(s.categories)
        and position($1 in s.address) > 0
        and not exists (select 1 from public.suppressions x where x.channel = 'email' and x.address = s.address)
      order by s.address limit 30`, [q]);
  return rows;
}

export async function scheduleTestAlert(db: Db, userId: string, input: {
  subject: unknown; body: unknown; scheduledAt: unknown; recipients: unknown; confirm: unknown;
}): Promise<string> {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (input.confirm !== true) throw new TestAlertInputError("Confirm that real emails will be sent.");
  if (!subject || subject.length > 150 || /[\r\n]/.test(subject)) throw new TestAlertInputError("Enter a subject of up to 150 characters on one line.");
  if (!body || body.length > 2000) throw new TestAlertInputError("Enter a message of up to 2,000 characters.");
  if (/\b(buy|sell)\b/i.test(`${subject} ${body}`)) throw new TestAlertInputError("Please avoid trading instructions in the subject and message.");
  if (typeof input.scheduledAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.scheduledAt)) {
    throw new TestAlertInputError("Choose a valid date and time.");
  }
  const date = new Date(input.scheduledAt);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new TestAlertInputError("Choose a time in the future.");
  if (!Array.isArray(input.recipients) || !input.recipients.length ||
      !input.recipients.every((id) => typeof id === "string" && /^[1-9]\d{0,17}$/.test(id)) ||
      new Set(input.recipients).size !== input.recipients.length) {
    throw new TestAlertInputError("Select at least one recipient, without duplicates.");
  }
  const recipients = input.recipients as string[];
  return inTransaction(db, async (c) => {
    const eligible = await c.query<{ id: string }>(
      `select s.id::text as id from public.alert_subscriptions s
        where s.id = any($1::bigint[]) and s.channel = 'email' and s.status = 'active' and s.cik is null
          and 'picks' = any(s.categories)
          and not exists (select 1 from public.suppressions x where x.channel = 'email' and x.address = s.address)
        for update of s`, [recipients]);
    if (eligible.rows.length !== recipients.length) throw new TestAlertInputError("A selected recipient is no longer eligible. Search again.");
    const { rows } = await c.query<{ id: string }>(
      `insert into public.test_alerts (created_by, subject, body, scheduled_at) values ($1, $2, $3, $4) returning id::text as id`,
      [userId, subject, body, date]);
    await c.query(`insert into public.test_alert_recipients (test_alert_id, subscription_id)
      select $1, unnest($2::bigint[])`, [rows[0].id, recipients]);
    return rows[0].id;
  });
}

export async function cancelTestAlert(db: Db, id: string): Promise<boolean> {
  if (!/^[1-9]\d{0,17}$/.test(id)) throw new TestAlertInputError("Invalid test alert.");
  return inTransaction(db, async (c) => {
    const job = await c.query(`update public.test_alerts set cancelled_at = now()
      where id = $1 and cancelled_at is null
        and exists (select 1 from public.test_alert_recipients r where r.test_alert_id = $1 and r.status in ('queued', 'sending'))
      returning id`, [id]);
    if (!job.rowCount) return false;
    await c.query(`update public.test_alert_recipients set status = 'cancelled'
      where test_alert_id = $1 and status = 'queued'`, [id]);
    return true;
  });
}

export type TestAlertJob = {
  id: string; subject: string; scheduledAt: string; cancelled: boolean;
  queued: number; sending: number; sent: number; suppressed: number; failed: number; cancelledCount: number;
  recipients: { address: string; status: string; error: string | null }[];
};

export async function listTestAlerts(db: Db): Promise<TestAlertJob[]> {
  const { rows } = await db.query<{
    id: string; subject: string; scheduled_at: Date; cancelled: boolean;
    recipients: { address: string; status: string; error: string | null }[];
  }>(`select t.id::text as id, t.subject, t.scheduled_at, t.cancelled_at is not null as cancelled,
      json_agg(json_build_object('address', s.address, 'status', r.status, 'error', r.error) order by s.address) as recipients
      from public.test_alerts t join public.test_alert_recipients r on r.test_alert_id = t.id
      join public.alert_subscriptions s on s.id = r.subscription_id
      where t.id in (select id from public.test_alerts order by created_at desc, id desc limit 20)
         or exists (select 1 from public.test_alert_recipients pending
           where pending.test_alert_id = t.id and pending.status in ('queued', 'sending'))
      group by t.id order by t.created_at desc, t.id desc`);
  return rows.map((row) => {
    const count = (status: string) => row.recipients.filter((r) => r.status === status).length;
    return { id: row.id, subject: row.subject, scheduledAt: new Date(row.scheduled_at).toISOString(),
      cancelled: row.cancelled, queued: count("queued"), sending: count("sending"), sent: count("sent"),
      suppressed: count("suppressed"), failed: count("failed"), cancelledCount: count("cancelled"), recipients: row.recipients };
  });
}

type Claimed = {
  id: string; delivery_key: string; job_id: string; subject: string; body: string; address: string; token: string; eligible: boolean; attempts: number;
};

/** One recipient at a time: cancellation serializes with claims, but cannot recall an in-flight email. */
export async function sendTestAlerts(db: Db, opts: { provider?: EmailProvider; limit?: number } = {}): Promise<number> {
  const provider = opts.provider ?? emailProvider();
  if (provider.name === "console" || !provider.configured()) throw new Error("A real email service must be configured for test alerts.");
  const address = postalAddress();
  if (!address) throw new Error("COMPANY_POSTAL_ADDRESS is required for test alerts.");
  await db.query(`update public.test_alert_recipients r set status = 'failed',
      error = 'Delivery outcome unknown after interruption'
    from public.test_alerts t where t.id = r.test_alert_id and r.status = 'sending'
      and r.next_attempt_at <= now() and (t.cancelled_at is not null or r.attempts >= $1)`, [MAX_ATTEMPTS]);
  let processed = 0;
  for (; processed < (opts.limit ?? 100); processed++) {
    const claimed = await inTransaction(db, async (c) => {
      const { rows: jobs } = await c.query<{ id: string }>(
        `select t.id::text as id from public.test_alerts t
          where t.cancelled_at is null and t.scheduled_at <= now()
            and exists (select 1 from public.test_alert_recipients r where r.test_alert_id = t.id
              and r.status in ('queued', 'sending') and r.next_attempt_at <= now())
          order by t.scheduled_at, t.id limit 1 for update of t skip locked`);
      if (!jobs.length) return null;
      const { rows } = await c.query<Claimed>(
        `with next as (
          select r.id from public.test_alert_recipients r where r.test_alert_id = $1
            and r.status in ('queued', 'sending') and r.next_attempt_at <= now()
          order by r.id limit 1 for update skip locked
        )
        update public.test_alert_recipients r set status = 'sending', attempts = r.attempts + 1,
          next_attempt_at = now() + interval '10 minutes'
        from next, public.test_alerts t, public.alert_subscriptions s
        where r.id = next.id and t.id = r.test_alert_id and s.id = r.subscription_id
        returning r.id::text as id, r.delivery_key::text as delivery_key, t.id::text as job_id, t.subject, t.body, s.address, s.unsubscribe_token as token, r.attempts,
          (s.channel = 'email' and s.status = 'active' and s.cik is null and 'picks' = any(s.categories)
            and not exists (select 1 from public.suppressions x where x.channel = 'email' and x.address = s.address)) as eligible`,
        [jobs[0].id]);
      return rows[0] ?? null;
    });
    if (!claimed) break;
    if (!claimed.eligible) {
      await db.query(`update public.test_alert_recipients set status = 'suppressed', error = 'Subscription is no longer eligible'
        where id = $1`, [claimed.id]);
      continue;
    }
    const token = encodeURIComponent(claimed.token);
    const site = siteUrl();
    const parts = testAlertEmail({ subject: claimed.subject, body: claimed.body, footer: {
      siteUrl: site, postalAddress: address, reason: "You're getting this test because you asked for the free BigStocks pick.",
      unsubscribeUrl: `${site}/unsubscribe?token=${token}`, oneClickUrl: `${site}/api/unsubscribe?token=${token}`,
    } });
    try {
      const out = await provider.send({ to: [claimed.address], ...parts }, { idempotencyKey: `bs-test-alert-${claimed.delivery_key}` });
      await db.query(`update public.test_alert_recipients set status = 'sent', sent_at = now(), error = null, provider_message_id = $2 where id = $1`,
        [claimed.id, out.id || null]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await inTransaction(db, async (c) => {
        const job = await c.query<{ cancelled: boolean }>(
          `select cancelled_at is not null as cancelled from public.test_alerts where id = $1 for update`, [claimed.job_id]);
        const status = job.rows[0].cancelled ? "cancelled" : claimed.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
        await c.query(`update public.test_alert_recipients set status = $2, error = $3,
          next_attempt_at = now() + make_interval(mins => $4) where id = $1`,
        [claimed.id, status, message.slice(0, 500), RETRY_MINUTES[Math.min(claimed.attempts - 1, RETRY_MINUTES.length - 1)]]);
      });
    }
  }
  return processed;
}
