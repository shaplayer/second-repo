import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { site } from "@/lib/follow/messages";

export const dynamic = "force-dynamic";

/**
 * Unsubscribe from BigStocks alert emails (the main list).
 * - Email clients' one-click button POSTs here (RFC 8058, List-Unsubscribe-Post).
 * - The form on /unsubscribe POSTs here too, then we redirect back with a confirmation.
 * Company follows (the bell) have their own links and aren't affected.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  let ok = false;
  if (hasDb() && /^[a-f0-9]{32}$/.test(token)) {
    const { rowCount } = await db().query(
      `UPDATE subscribers SET general_alerts = FALSE WHERE unsub_token = $1 AND email IS NOT NULL`, [token],
    );
    ok = Boolean(rowCount);
  }
  const isForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")
    && !(await req.clone().text()).includes("List-Unsubscribe=One-Click");
  if (isForm) return NextResponse.redirect(`${site()}/unsubscribe?t=${encodeURIComponent(token)}&done=1`, 303);
  return NextResponse.json({ ok });
}

/** A plain link click: show the confirmation page instead of unsubscribing on GET (link scanners click everything). */
export function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  return NextResponse.redirect(`${site()}/unsubscribe?t=${encodeURIComponent(token)}`, 303);
}
