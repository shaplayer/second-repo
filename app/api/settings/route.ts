import { SIGNED_IN_CONSENT } from "@/components/signup/consent";
import { setCadence, setCategory, signUp, stopEverything, stopOwnSubscription } from "@/lib/alerts/subscriptions";
import { db } from "@/lib/db";
import { CATEGORIES, type Category } from "@/lib/plain";
import { clientIp, currentUser, json, readJson, sameOrigin, userAgent } from "@/lib/web/request";

/**
 * Alert settings of the signed-in person (their own, confirmed address). One change per request:
 *   { category, on }   a kind of news, for every company they follow
 *   { cadence }        "instant" or "digest"
 *   { picks }          the free pick list on or off
 *   { stopAll: true }  unsubscribe from everything
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false }, 403);
  const user = await currentUser();
  if (!user) return json({ ok: false, error: "Please sign in first.", signIn: true }, 401);
  const body = await readJson(req);
  const pool = db();
  if (body.stopAll === true) {
    await stopEverything(pool, user.email);
  } else if (typeof body.category === "string" && (CATEGORIES as readonly string[]).includes(body.category)) {
    await setCategory(pool, user.email, body.category as Category, body.on === true);
  } else if (body.cadence === "instant" || body.cadence === "digest") {
    await setCadence(pool, user.email, body.cadence);
  } else if (typeof body.picks === "boolean") {
    if (body.picks) {
      const r = await signUp(pool, {
        email: user.email, picks: true, source: "settings", consentText: SIGNED_IN_CONSENT, ip: await clientIp(), userAgent: await userAgent(),
        verifiedEmail: user.email, userId: user.id,
      });
      if (r.suppressed) return json({ ok: false, error: "We can't send email to your address. If you think that's a mistake, contact us." }, 400);
    } else {
      await stopOwnSubscription(pool, user.email, null);
    }
  } else {
    return json({ ok: false, error: "Nothing to change." }, 400);
  }
  return json({ ok: true });
}
