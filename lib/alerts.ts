import { db, hasDb } from "./db";

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

const COLS = `id, ticker, alerted_at, created_at, alert_price, high_after, close_after,
  COALESCE(result, 'open') AS result, sponsored, sponsor_comp, notes`;

function mapRow(r: Record<string, unknown>): AlertRow {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    ticker: String(r.ticker),
    alertedAt: new Date(r.alerted_at as string).toISOString(),
    loggedAt: new Date(r.created_at as string).toISOString(),
    alertPrice: Number(r.alert_price),
    highAfter: num(r.high_after),
    closeAfter: num(r.close_after),
    result: r.result as AlertResult,
    sponsored: Boolean(r.sponsored),
    sponsorComp: (r.sponsor_comp as string) ?? null,
    notes: (r.notes as string) ?? null,
  };
}

function where(f: AlertFilter, args: unknown[]) {
  const w: string[] = [];
  if (f.type === "organic") w.push("NOT sponsored");
  if (f.type === "sponsored") w.push("sponsored");
  if (f.result && f.result !== "all") { args.push(f.result); w.push(`COALESCE(result,'open') = $${args.length}`); }
  if (f.ticker) { args.push(f.ticker); w.push(`ticker = $${args.length}`); }
  return w.length ? `WHERE ${w.join(" AND ")}` : "";
}

/** Latest alerts (homepage preview). Real data only: empty until the table is filled. */
export async function recentAlerts(limit = 5): Promise<AlertRow[]> {
  return (await listAlerts({}, 1, limit).catch(() => ({ rows: [] as AlertRow[] }))).rows;
}

export async function listAlerts(f: AlertFilter, page = 1, pageSize = 50): Promise<{ rows: AlertRow[]; total: number }> {
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
  if (!hasDb()) return [];
  try {
    const args: unknown[] = [];
    const w = where({ ...f, result: "all" }, args);
    args.push(limit);
    const { rows } = await db().query(
      `SELECT * FROM (SELECT id, ticker, alerted_at, COALESCE(result,'open') AS result FROM alerts ${w}
        ORDER BY alerted_at DESC, id DESC LIMIT $${args.length}) t ORDER BY alerted_at ASC, id ASC`,
      args,
    );
    return rows.map((r) => ({ id: String(r.id), ticker: r.ticker, alertedAt: new Date(r.alerted_at).toISOString(), result: r.result }));
  } catch { return []; }
}

export async function alertStats(f: AlertFilter): Promise<AlertStats> {
  const empty: AlertStats = { total: 0, wins: 0, losses: 0, flat: 0, open: 0, winRate: null, avgClosePct: null, avgHighPct: null, bestHighPct: null, worstClosePct: null, firstAt: null };
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
