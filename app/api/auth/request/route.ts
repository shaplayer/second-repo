import { sendSignInLink } from "@/lib/alerts/mail";
import { normalizeEmail, safeNextPath } from "@/lib/auth/accounts";
import { db } from "@/lib/db";
import { clientIp, json, readJson, sameOrigin } from "@/lib/web/request";

/**
 * "Email me a sign-in link". The reply never says whether the address has an account: signing in
 * with a new address simply creates one.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "That request didn't come from this site." }, 403);
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email) return json({ ok: false, error: "That email address doesn't look right. Check it and try again." }, 400);
  try {
    const sent = await sendSignInLink(db(), email, { nextPath: safeNextPath(body.next), visitor: await clientIp() });
    if (sent === "limited") return json({ ok: false, error: "Too many sign-in links in a short time. Please try again in an hour." }, 429);
    return json({ ok: true });
  } catch (e) {
    console.error("[auth/request]", (e as Error).message);
    return json({ ok: false, error: "We couldn't send the link just now. Please try again in a minute." }, 502);
  }
}
