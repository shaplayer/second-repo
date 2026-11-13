import { db } from "@/lib/db";
import { json } from "@/lib/web/request";

/**
 * "Is the site up, and is the worker keeping up?" for the deploy check and for uptime monitors.
 * No secrets and no personal data: only whether the database answers and how fresh the feed is.
 */
export async function GET() {
  try {
    const { rows } = await db().query<{ newest: Date | null; worker: Date | null }>(
      `select (select max(accepted_at) from public.filings) as newest,
              (select last_success_at from public.job_state where job = 'filings') as worker`,
    );
    const age = (d: Date | null) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 1000) : null);
    return json({ ok: true, database: "up", newestFilingSecondsAgo: age(rows[0].newest), workerLastWorkedSecondsAgo: age(rows[0].worker) });
  } catch {
    return json({ ok: false, database: "down" }, 503);
  }
}
