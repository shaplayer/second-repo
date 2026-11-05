import { db, hasDb } from "./db";

export type AlertRow = {
  id: string;
  ticker: string;
  alertedAt: string;
  alertPrice: number;
  highAfter: number | null;
  result: "win" | "loss" | "flat" | "open" | null;
  sponsored: boolean;
  sponsorComp: string | null;
};

/** Latest alerts for the public track record. Real data only: empty until the table is filled. */
export async function recentAlerts(limit = 5): Promise<AlertRow[]> {
  if (!hasDb()) return [];
  try {
    const { rows } = await db().query(
      `SELECT id, ticker, alerted_at, alert_price, high_after, result, sponsored, sponsor_comp
         FROM alerts ORDER BY alerted_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      ticker: r.ticker,
      alertedAt: new Date(r.alerted_at).toISOString(),
      alertPrice: Number(r.alert_price),
      highAfter: r.high_after == null ? null : Number(r.high_after),
      result: r.result,
      sponsored: r.sponsored,
      sponsorComp: r.sponsor_comp,
    }));
  } catch (e) {
    console.warn("[alerts]", (e as Error).message);
    return [];
  }
}
