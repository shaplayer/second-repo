import { NextResponse } from "next/server";
import { unsubscribe } from "@/lib/alerts/subscriptions";
import { db } from "@/lib/db";
import { json } from "@/lib/web/request";

/**
 * The unsubscribe address used in emails the OLD data site already sent. Opening the link shows our
 * unsubscribe page; a mail app's one-click button (a POST) stops the alerts at once, as it did then.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = q.get("token") ?? q.get("t") ?? "";
  return NextResponse.redirect(new URL(`/unsubscribe?token=${encodeURIComponent(token)}`, req.url), 303);
}

export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = q.get("token") ?? q.get("t") ?? "";
  const done = await unsubscribe(db(), token, "this");
  return json({ ok: true, stopped: done?.stopped ?? 0 });
}
