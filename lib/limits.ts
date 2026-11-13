/**
 * "At most N of these per window" counters, kept in the database so they survive a restart and are
 * shared by the web app and the worker. Used to stop the sign-up and sign-in forms from being used to
 * flood someone's inbox, and to cap what one visitor can ask the summarizer to write.
 */
import type { Client, Pool, PoolClient } from "pg";

type Db = Pool | PoolClient | Client;

export type Limit = { bucket: string; max: number; windowSeconds: number };

export const LIMITS = {
  /** Confirmation and "already subscribed" emails to one address. */
  signupPerAddress: { bucket: "signup:address", max: 4, windowSeconds: 3600 },
  signupPerVisitor: { bucket: "signup:ip", max: 12, windowSeconds: 3600 },
  signInPerAddress: { bucket: "signin:address", max: 5, windowSeconds: 3600 },
  signInPerVisitor: { bucket: "signin:ip", max: 15, windowSeconds: 3600 },
  inquiryPerVisitor: { bucket: "inquiry:ip", max: 5, windowSeconds: 3600 },
  /** New summaries one visitor can start by opening items. */
  summaryPerVisitor: { bucket: "summary:ip", max: 40, windowSeconds: 3600 },
  /** New summaries started by all visitors together, per day (a cost guard). */
  summaryPerDay: { bucket: "summary:all", max: 3000, windowSeconds: 86400 },
} as const satisfies Record<string, Limit>;

/**
 * Counts one use and says whether it is allowed. The count is taken first and atomically, so two
 * requests arriving together cannot both slip under the limit.
 */
export async function allow(db: Db, limit: Limit, key: string): Promise<boolean> {
  const { rows } = await db.query<{ hits: number }>(
    `insert into public.rate_limits (bucket, key, window_start, hits)
     values ($1, $2, to_timestamp(floor(extract(epoch from now()) / $3) * $3), 1)
     on conflict (bucket, key, window_start) do update set hits = public.rate_limits.hits + 1
     returning hits`,
    [limit.bucket, key.slice(0, 200), limit.windowSeconds],
  );
  return rows[0].hits <= limit.max;
}

/** Removes counters that can no longer matter. Run by the worker once in a while. */
export async function clearOldLimits(db: Db): Promise<number> {
  const r = await db.query(`delete from public.rate_limits where window_start < now() - interval '2 days'`);
  return r.rowCount ?? 0;
}
