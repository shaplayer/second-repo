import type { Pool } from "pg";
import type { AdminData } from "../admin-query";
import { listTestAlerts } from "../alerts/test-alerts";
import { postalAddress, smsEnabled } from "../config";
import { emailProvider } from "../email";
import { listPicks, listScheduledPicks } from "./picks";

export const adminLoaders = {
  counts: async (pool: Pool) => (await pool.query<AdminData["counts"]>(`
    select (select count(*) from public.alert_subscriptions where channel = 'email' and status = 'active' and cik is null and 'picks' = any(categories)) as picks,
      (select count(distinct address) from public.alert_subscriptions where channel = 'email' and status = 'active') as people,
      (select count(*) from public.alert_subscriptions where channel = 'email' and status = 'pending') as pending,
      (select count(*) from public.alert_events where status = 'queued') as queued,
      (select count(*) from public.alert_events where status = 'sent' and sent_at > now() - interval '24 hours') as sent,
      (select count(*) from public.alert_events where status = 'failed' and created_at > now() - interval '24 hours') as failed,
      (select count(*) from public.summaries where kind = 'ai' and created_at > now() - interval '24 hours') as summaries
  `)).rows[0],
  config: async () => ({
    problems: [
      !postalAddress() && "COMPANY_POSTAL_ADDRESS is not set: alert emails are held back until it is.",
      emailProvider().name === "console" && "EMAIL_PROVIDER is “console”: emails are printed to the log, not sent.",
      !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY is not set: no AI summaries are written.",
    ].filter((problem): problem is string => Boolean(problem)),
    smsEnabled: smsEnabled(),
  }),
  jobs: async (pool: Pool) => (await pool.query<{
    job: string; last_success_at: Date | null; last_error: string | null; last_error_at: Date | null;
  }>("select job, last_success_at, last_error, last_error_at from public.job_state where job not like '%:last' order by job")).rows.map((job) => ({
    ...job, last_success_at: job.last_success_at?.toISOString() ?? null, last_error_at: job.last_error_at?.toISOString() ?? null,
  })),
  inquiries: async (pool: Pool) => (await pool.query<Omit<AdminData["inquiries"][number], "created_at"> & { created_at: Date }>(
    "select id::text as id, name, company, ticker, email, phone, package, message, created_at from public.inquiries where imported_from is null order by created_at desc limit 20",
  )).rows.map((inquiry) => ({ ...inquiry, created_at: inquiry.created_at.toISOString() })),
  "list-size": async (pool: Pool) => Number((await pool.query<{ picks: string }>(
    "select count(*) as picks from public.alert_subscriptions where channel = 'email' and status = 'active' and cik is null and 'picks' = any(categories)",
  )).rows[0].picks),
  picks: (pool: Pool) => listPicks(pool, { limit: 8 }),
  "scheduled-picks": listScheduledPicks,
  "test-alerts": listTestAlerts,
} satisfies { [K in Exclude<keyof AdminData, "session">]: (pool: Pool) => Promise<AdminData[K]> };
