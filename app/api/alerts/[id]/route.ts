import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { alertsKeyOk } from "@/lib/api-auth";
import { resultFromClose, type AlertResult } from "@/lib/alerts";

export const dynamic = "force-dynamic";

const RESULTS: AlertResult[] = ["win", "loss", "flat", "open"];

/**
 * Record an alert's outcome (after the session).
 * PATCH /api/alerts/123   Authorization: Bearer $ALERTS_API_KEY
 * {"high_after":2.71,"close_after":2.40}            -> result computed from the close
 * {"high_after":2.71,"close_after":2.40,"result":"win"}  -> explicit result
 * Ticker, time, price and sponsorship can't be changed (enforced by the database).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!alertsKeyOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const cur = (await db().query(`SELECT alert_price, high_after, close_after FROM alerts WHERE id = $1`, [id])).rows[0];
  if (!cur) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const num = (k: string, fallback: unknown) => (k in b ? (b[k] == null ? null : Number(b[k])) : fallback == null ? null : Number(fallback));
  const high = num("high_after", cur.high_after);
  const close = num("close_after", cur.close_after);
  for (const [k, v] of [["high_after", high], ["close_after", close]] as const) {
    if (v != null && !(v > 0)) return NextResponse.json({ error: `${k} must be > 0` }, { status: 400 });
  }
  const explicit = typeof b.result === "string" ? (b.result as AlertResult) : null;
  if (explicit && !RESULTS.includes(explicit)) return NextResponse.json({ error: "result must be win|loss|flat|open" }, { status: 400 });
  const result = explicit ?? resultFromClose(Number(cur.alert_price), close);

  await db().query(
    `UPDATE alerts SET high_after = $2, close_after = $3, result = $4, notes = COALESCE($5, notes) WHERE id = $1`,
    [id, high, close, result, typeof b.notes === "string" ? b.notes.slice(0, 1000) : null],
  );
  return NextResponse.json({ id: String(id), result });
}
