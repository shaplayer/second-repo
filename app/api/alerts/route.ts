import { NextResponse, after } from "next/server";
import { dispatchFollowNotifications } from "@/lib/follow/notify";
import { db, hasDb } from "@/lib/db";
import { alertsKeyOk } from "@/lib/api-auth";
import { normalizeTicker } from "@/lib/feeds/tickers";
import { createAlert, processBroadcasts, type Channel } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

/**
 * Log a new alert (called by your alert system the moment an alert is sent).
 * POST /api/alerts   Authorization: Bearer $ALERTS_API_KEY
 * {"ticker":"ABCD","alerted_at":"2026-11-05T12:58:00Z","alert_price":2.15,
 *  "sponsored":false,"sponsor_comp":null,"notes":null,"tier":"free","message":null}
 * alerted_at defaults to now. Sponsored alerts require sponsor_comp (the disclosure text).
 * tier: "free" (default) or "premium" (hidden on the public record until 4 PM ET that day).
 *
 * Add "send": true (and optionally "channels": ["sms","email"]) to also send it to the list,
 * exactly like the /admin page does. Sent alerts are always timestamped now.
 */
export async function POST(req: Request) {
  if (!alertsKeyOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const ticker = normalizeTicker(String(b.ticker ?? ""));
  const price = Number(b.alert_price);
  const at = b.alerted_at ? new Date(String(b.alerted_at)) : new Date();
  const sponsored = b.sponsored === true;
  const comp = typeof b.sponsor_comp === "string" && b.sponsor_comp.trim() ? b.sponsor_comp.trim().slice(0, 500) : null;

  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  if (!(price > 0)) return NextResponse.json({ error: "alert_price must be > 0" }, { status: 400 });
  if (!Number.isFinite(at.getTime()) || at.getTime() > Date.now() + 5 * 60_000) {
    return NextResponse.json({ error: "alerted_at must be a valid time, not in the future" }, { status: 400 });
  }
  if (sponsored && !comp) return NextResponse.json({ error: "sponsor_comp (compensation disclosure) is required for sponsored alerts" }, { status: 400 });
  const tier = b.tier === "premium" ? "premium" : "free";
  const message = typeof b.message === "string" ? b.message.slice(0, 1000) : null;

  if (b.send === true) {
    try {
      const channels = (Array.isArray(b.channels) ? b.channels : ["sms", "email"]) as Channel[];
      const r = await createAlert({ ticker, price, tier, message, sponsored, sponsorComp: comp, channels });
      after(() => processBroadcasts().catch((e) => console.error("[broadcast]", e?.message)));
      after(() => dispatchFollowNotifications().catch((e) => console.error("[follow]", e?.message)));
      return NextResponse.json({ id: r.alertId, broadcast_id: r.broadcastId }, { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  const { rows } = await db().query(
    `INSERT INTO alerts (ticker, alerted_at, alert_price, sponsored, sponsor_comp, notes, tier, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [ticker, at.toISOString(), price, sponsored, comp, typeof b.notes === "string" ? b.notes.slice(0, 1000) : null, tier, message],
  );
  // Tell this stock's followers now, after responding (the ingest worker also catches anything missed).
  after(() => dispatchFollowNotifications().catch((e) => console.error("[follow]", e?.message)));
  return NextResponse.json({ id: String(rows[0].id) }, { status: 201 });
}
