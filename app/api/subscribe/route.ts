import { consentFor, SIGNED_IN_CONSENT } from "@/components/signup/consent";
import { sendAlreadySubscribed, sendConfirmation } from "@/lib/alerts/mail";
import { signUp } from "@/lib/alerts/subscriptions";
import { normalizeEmail } from "@/lib/auth/accounts";
import { getCompanyByCik } from "@/lib/data/companies";
import { db } from "@/lib/db";
import { clientIp, currentUser, json, readJson, sameOrigin, userAgent } from "@/lib/web/request";
import { pendingSignup, rememberSignup } from "@/lib/web/signup-cookie";

/**
 * Sign up for email alerts: the free pick list and, optionally, one company.
 * Nothing is switched on here. The address gets one confirmation email; only the click on its link
 * makes the alerts active. The reply is the same whether or not the address was already on a list.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "That request didn't come from this site." }, 403);
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email) return json({ ok: false, error: "That email address doesn't look right. Check it and try again." }, 400);
  const pool = db();
  const cik = typeof body.cik === "number" && Number.isSafeInteger(body.cik) && body.cik > 0 ? body.cik : null;
  const company = cik ? await getCompanyByCik(pool, cik) : null;
  if (cik && !company) return json({ ok: false, error: "We couldn't find that company." }, 400);
  const picks = body.picks !== false;
  const [user, ip, ua, waiting] = await Promise.all([currentUser(), clientIp(), userAgent(), pendingSignup()]);
  const own = user?.email === email;
  // Adding to a sign-up that is already waiting in this browser, for the same address.
  const batch = waiting && waiting.email === email && typeof body.batch === "string" && body.batch === waiting.batch ? waiting.batch : null;

  const result = await signUp(pool, {
    email, cik, picks, source: String(body.source ?? "site").slice(0, 80), ip, userAgent: ua, batch,
    consentText: own ? SIGNED_IN_CONSENT : consentFor(company?.ticker, picks),
    verifiedEmail: own ? user!.email : null, userId: own ? user!.id : null,
  });
  if (result.suppressed) {
    return json({ ok: false, error: "We can't send email to that address. If you think that's a mistake, contact us." }, 400);
  }
  if (own) {
    if (cik) await pool.query(`insert into public.watchlists (user_id, cik) values ($1, $2) on conflict do nothing`, [user!.id, cik]);
    return json({ ok: true, next: "/my-stocks" });
  }
  try {
    if (result.confirmToken) {
      const sent = await sendConfirmation(pool, result.confirmToken, { visitor: ip });
      if (sent === "limited") return json({ ok: false, error: "Too many sign-ups in a short time. Please try again in an hour." }, 429);
      await rememberSignup({ email, batch: result.batch, confirmToken: result.confirmToken });
    } else if (result.alreadyActive) {
      await sendAlreadySubscribed(pool, email, { visitor: ip });
    }
  } catch (e) {
    console.error("[subscribe] could not send the confirmation email:", (e as Error).message);
    return json({ ok: false, error: "We couldn't send the confirmation email just now. Please try again in a minute." }, 502);
  }
  return json({ ok: true, next: "/confirm" });
}
