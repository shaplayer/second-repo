import { db, hasDb } from "./db";
// Preview mode, same switch as the sample news feed (lib/feeds/sample.ts). Never on in production.
const sampleEnabled = () => process.env.FEED_SAMPLE === "1" && process.env.NODE_ENV !== "production";
import { sampleAlerts } from "./alerts-sample";

export type AlertResult = "win" | "loss" | "flat" | "open";
export type AlertRow = {
  id: string;
  ticker: string;
  alertedAt: string;
  loggedAt: string;
  alertPrice: number;
  highAfter: number | null;
  closeAfter: number | null;
  result: AlertResult;
  sponsored: boolean;
  sponsorComp: string | null;
  notes: string | null;
  tier: "free" | "premium";
  /** Premium pick sent today: ticker and prices are hidden until 4:00 PM ET. */
  hidden: boolean;
};

export type AlertFilter = {
  type?: "all" | "organic" | "sponsored";
  result?: AlertResult | "all";
  ticker?: string | null;
};

export type AlertStats = {
  total: number; wins: number; losses: number; flat: number; open: number;
  winRate: number | null;        // wins / (wins + losses + flat)
  avgClosePct: number | null;    // mean % change alert -> close
  avgHighPct: number | null;     // mean % change alert -> high after
  bestHighPct: number | null;
  worstClosePct: number | null;
  firstAt: string | null;
};

/**
 * Premium picks stay hidden on the public record until the next 4:00 PM ET close after they're sent
 * (same day for a morning pick; the next day if sent after the close).
 */
const HIDDEN = `(COALESCE(tier, 'free') = 'premium' AND now() <
  ((date_trunc('day', alerted_at AT TIME ZONE 'America/New_York')
    + CASE WHEN (alerted_at AT TIME ZONE 'America/New_York')::time >= '16:00' THEN interval '40 hours' ELSE interval '16 hours' END)
   AT TIME ZONE 'America/New_York'))`;

const COLS = `id, ticker, alerted_at, created_at, alert_price, high_after, close_after,
  COALESCE(result, 'open') AS result, sponsored, sponsor_comp, notes, COALESCE(tier, 'free') AS tier, ${HIDDEN} AS hidden`;

function mapRow(r: Record<string, unknown>): AlertRow {
  const num = (v: unknown) => (v == null ? null : Number(v));
  const hidden = Boolean(r.hidden);
  return {
    id: String(r.id),
    ticker: hidden ? "" : String(r.ticker),
    alertedAt: new Date(r.alerted_at as string).toISOString(),
    loggedAt: new Date(r.created_at as string).toISOString(),
    alertPrice: hidden ? 0 : Number(r.alert_price),
    highAfter: hidden ? null : num(r.high_after),
    closeAfter: hidden ? null : num(r.close_after),
    result: hidden ? "open" : (r.result as AlertResult),
    sponsored: Boolean(r.sponsored),
    sponsorComp: hidden ? null : (r.sponsor_comp as string) ?? null,
    notes: hidden ? null : (r.notes as string) ?? null,
    tier: r.tier === "premium" ? "premium" : "free",
    hidden,
  };
}

function where(f: AlertFilter, args: unknown[]) {
  const w: string[] = [];
  if (f.type === "organic") w.push("NOT sponsored");
  if (f.type === "sponsored") w.push("sponsored");
  if (f.result && f.result !== "all") { args.push(f.result); w.push(`COALESCE(result,'open') = $${args.length}`); }
  if (f.ticker) { args.push(f.ticker); w.push(`ticker = $${args.length}`, `NOT ${HIDDEN}`); }
  return w.length ? `WHERE ${w.join(" AND ")}` : "";
}

/** Latest alerts (homepage preview). Real data only: empty until the table is filled. */
export async function recentAlerts(limit = 5): Promise<AlertRow[]> {
  return (await listAlerts({}, 1, limit).catch(() => ({ rows: [] as AlertRow[] }))).rows;
}

export async function listAlerts(f: AlertFilter, page = 1, pageSize = 50): Promise<{ rows: AlertRow[]; total: number }> {
  if (sampleEnabled()) {
    const rows = filterSample(f);
    return { rows: rows.slice((Math.max(page, 1) - 1) * pageSize, Math.max(page, 1) * pageSize), total: rows.length };
  }
  if (!hasDb()) return { rows: [], total: 0 };
  try {
    const args: unknown[] = [];
    const w = where(f, args);
    const total = Number((await db().query(`SELECT count(*) FROM alerts ${w}`, args)).rows[0].count);
    args.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    const { rows } = await db().query(
      `SELECT ${COLS} FROM alerts ${w} ORDER BY alerted_at DESC, id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    return { rows: rows.map(mapRow), total };
  } catch (e) {
    console.warn("[alerts]", (e as Error).message);
    return { rows: [], total: 0 };
  }
}

/** Results (oldest -> newest) for the results strip. */
export async function resultSequence(f: AlertFilter, limit = 60): Promise<Pick<AlertRow, "id" | "ticker" | "alertedAt" | "result">[]> {
  if (sampleEnabled()) return filterSample({ ...f, result: "all" }).slice(0, limit).reverse();
  if (!hasDb()) return [];
  try {
    const args: unknown[] = [];
    const w = where({ ...f, result: "all" }, args);
    args.push(limit);
    const { rows } = await db().query(
      `SELECT * FROM (SELECT id, CASE WHEN ${HIDDEN} THEN '' ELSE ticker END AS ticker, alerted_at,
                CASE WHEN ${HIDDEN} THEN 'open' ELSE COALESCE(result,'open') END AS result FROM alerts ${w}
        ORDER BY alerted_at DESC, id DESC LIMIT $${args.length}) t ORDER BY alerted_at ASC, id ASC`,
      args,
    );
    return rows.map((r) => ({ id: String(r.id), ticker: r.ticker, alertedAt: new Date(r.alerted_at).toISOString(), result: r.result }));
  } catch { return []; }
}

export async function alertStats(f: AlertFilter): Promise<AlertStats> {
  const empty: AlertStats = { total: 0, wins: 0, losses: 0, flat: 0, open: 0, winRate: null, avgClosePct: null, avgHighPct: null, bestHighPct: null, worstClosePct: null, firstAt: null };
  if (sampleEnabled()) return statsOf(filterSample({ type: f.type }));
  if (!hasDb()) return empty;
  try {
    const args: unknown[] = [];
    const w = where({ type: f.type }, args);
    const { rows } = await db().query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE result = 'win')::int AS wins,
              count(*) FILTER (WHERE result = 'loss')::int AS losses,
              count(*) FILTER (WHERE result = 'flat')::int AS flat,
              count(*) FILTER (WHERE result IS NULL OR result = 'open')::int AS open,
              avg((close_after - alert_price) / alert_price * 100) FILTER (WHERE close_after IS NOT NULL) AS avg_close,
              avg((high_after - alert_price) / alert_price * 100) FILTER (WHERE high_after IS NOT NULL) AS avg_high,
              max((high_after - alert_price) / alert_price * 100) AS best_high,
              min((close_after - alert_price) / alert_price * 100) AS worst_close,
              min(alerted_at) AS first_at
         FROM alerts ${w}`,
      args,
    );
    const r = rows[0];
    const n = (v: unknown) => (v == null ? null : Number(v));
    const closed = r.wins + r.losses + r.flat;
    return {
      total: r.total, wins: r.wins, losses: r.losses, flat: r.flat, open: r.open,
      winRate: closed ? (r.wins / closed) * 100 : null,
      avgClosePct: n(r.avg_close), avgHighPct: n(r.avg_high),
      bestHighPct: n(r.best_high), worstClosePct: n(r.worst_close),
      firstAt: r.first_at ? new Date(r.first_at).toISOString() : null,
    };
  } catch (e) {
    console.warn("[alerts] stats", (e as Error).message);
    return empty;
  }
}

/** Outcome rule used when the result isn't given explicitly. */
export function resultFromClose(alertPrice: number, close: number | null): AlertResult {
  if (close == null) return "open";
  if (close > alertPrice) return "win";
  if (close < alertPrice) return "loss";
  return "flat";
}

export const pct = (from: number, to: number | null) => (to == null || !from ? null : ((to - from) / from) * 100);

/* ---------- Preview mode (FEED_SAMPLE=1, never in production): example alerts, nothing in the database ---------- */

function filterSample(f: AlertFilter): AlertRow[] {
  return sampleAlerts().filter((a) =>
    (f.type !== "organic" || !a.sponsored) && (f.type !== "sponsored" || a.sponsored)
    && (!f.result || f.result === "all" || a.result === f.result) && (!f.ticker || (a.ticker === f.ticker && !a.hidden)));
}

function statsOf(rows: AlertRow[]): AlertStats {
  const closed = rows.filter((r) => r.closeAfter != null && !r.hidden);
  const highs = rows.filter((r) => r.highAfter != null && !r.hidden);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const c = closed.map((r) => pct(r.alertPrice, r.closeAfter)!);
  const h = highs.map((r) => pct(r.alertPrice, r.highAfter)!);
  const wins = rows.filter((r) => r.result === "win").length;
  const losses = rows.filter((r) => r.result === "loss").length;
  const flat = rows.filter((r) => r.result === "flat").length;
  return {
    total: rows.length, wins, losses, flat, open: rows.filter((r) => r.result === "open").length,
    winRate: wins + losses + flat ? (wins / (wins + losses + flat)) * 100 : null,
    avgClosePct: avg(c), avgHighPct: avg(h),
    bestHighPct: h.length ? Math.max(...h) : null, worstClosePct: c.length ? Math.min(...c) : null,
    firstAt: rows.length ? rows[rows.length - 1].alertedAt : null,
  };
}
