import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { site } from "@/lib/follow/messages";

export const dynamic = "force-dynamic";

/**
 * Unsubscribe from one company's emails.
 * - Email clients' one-click button POSTs here (RFC 8058, List-Unsubscribe-Post).
 * - The form on /follow/unsubscribe POSTs here too, then we redirect back with a confirmation.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  let ticker: string | null = null;
  if (hasDb() && /^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    const { rows } = await db().query(
      `UPDATE ticker_follows SET unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE token = $1 RETURNING ticker`,
      [token],
    );
    ticker = rows[0]?.ticker ?? null;
  }
  const isForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")
    && !(await req.clone().text()).includes("List-Unsubscribe=One-Click");
  if (isForm) return NextResponse.redirect(`${site()}/follow/unsubscribe?t=${encodeURIComponent(token)}&done=1`, 303);
  return NextResponse.json({ ok: Boolean(ticker) });
}
