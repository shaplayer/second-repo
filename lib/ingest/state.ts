/**
 * The worker's record of its own jobs (public.job_state): when each last ran, when it last worked,
 * and what went wrong last. The health page and `npm run feeds:check` read it.
 */
import { shortError, type Db } from "./db";

/**
 * Runs one job and records how it went. Never throws: a failing job returns null and leaves one
 * log line, so one broken job cannot stop the worker's loop.
 */
export async function runJob<T>(db: Db, job: string, fn: () => Promise<T>): Promise<T | null> {
  const note = async (sql: string, params: unknown[]) => {
    try {
      await db.query(sql, params);
    } catch (e) {
      console.error(`[job ${job}] could not record its state: ${shortError(e)}`);
    }
  };
  await note(
    `insert into public.job_state (job, last_run_at) values ($1, now())
     on conflict (job) do update set last_run_at = now(), updated_at = now()`,
    [job],
  );
  try {
    const result = await fn();
    await note(`update public.job_state set last_success_at = now(), updated_at = now() where job = $1`, [job]);
    return result;
  } catch (e) {
    const message = shortError(e, 500);
    console.error(`[job ${job}] failed: ${message}`);
    await note(`update public.job_state set last_error = $2, last_error_at = now(), updated_at = now() where job = $1`, [job, message]);
    return null;
  }
}

/** Replaces the job's small record of counters and positions. */
export async function setJobDetail(db: Db, job: string, detail: object): Promise<void> {
  await db.query(
    `insert into public.job_state (job, detail) values ($1, $2::jsonb)
     on conflict (job) do update set detail = excluded.detail, updated_at = now()`,
    [job, JSON.stringify(detail ?? {})],
  );
}
