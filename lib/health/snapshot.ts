/**
 * Saves one night's health check for a company in public.fundamentals_snapshots (server-only table).
 * One row per company per day: saving again on the same day replaces that day's row.
 */
import type { Client, PoolClient } from "pg";
import type { Fundamentals } from "./types";

export async function saveSnapshot(client: Client | PoolClient, cik: number, f: Fundamentals): Promise<void> {
  if (!Number.isInteger(cik) || cik <= 0) throw new RangeError(`saveSnapshot needs a company's CIK number, got ${cik}`);
  const { health } = f;
  await client.query(
    `insert into public.fundamentals_snapshots
       (cik, as_of, quarters, ttm, score, verdict, rule_set, no_score_reason, source_filed)
     values ($1, $2::date, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $9::date)
     on conflict (cik, as_of) do update set
       quarters = excluded.quarters,
       ttm = excluded.ttm,
       score = excluded.score,
       verdict = excluded.verdict,
       rule_set = excluded.rule_set,
       no_score_reason = excluded.no_score_reason,
       source_filed = excluded.source_filed`,
    [
      cik,
      f.asOf,
      JSON.stringify(f.quarters),
      JSON.stringify({ ...f.ttm, cash: f.cash }),
      JSON.stringify(health),
      health.verdict,
      health.ruleSet,
      health.noScoreReason,
      f.sourceFiled,
    ],
  );
}
