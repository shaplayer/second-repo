import { NextResponse } from "next/server";
import { confirmSignup } from "@/lib/alerts/subscriptions";
import { signInVerifiedEmail } from "@/lib/auth/accounts";
import { db } from "@/lib/db";
import { clientIp, sameOrigin, setSessionCookie, userAgent } from "@/lib/web/request";
import { forgetSignup } from "@/lib/web/signup-cookie";

/**
 * The confirmation click: the button on the page the emailed link opens. A POST, so that mail
 * scanners that open every link in a message cannot confirm on someone's behalf.
 * Confirming proves the inbox is theirs, so it also signs them in (and makes their free account).
 */
export async function POST(req: Request) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  if (!sameOrigin(req)) return to("/confirm?problem=1");
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  const pool = db();
  const done = await confirmSignup(pool, token, { ip, userAgent: ua });
  if (!done) return to("/confirm?problem=1");
  if (!done.confirmed.length && !done.alreadyConfirmed) return to("/confirm?problem=1");
  const { user, sessionToken } = await signInVerifiedEmail(pool, done.email, { ip, userAgent: ua });
  // The companies they just confirmed show up under My stocks.
  for (const s of done.confirmed) {
    if (s.cik !== null) {
      await pool.query(`insert into public.watchlists (user_id, cik) values ($1, $2) on conflict do nothing`, [user.id, s.cik]);
      await pool.query(`update public.companies set tracked = true where cik = $1 and not tracked`, [s.cik]);
    }
  }
  await setSessionCookie(sessionToken);
  await forgetSignup();
  return to("/confirm?done=1");
}
