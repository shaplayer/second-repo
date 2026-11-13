import { sendConfirmation } from "@/lib/alerts/mail";
import { db } from "@/lib/db";
import { clientIp, json, sameOrigin } from "@/lib/web/request";
import { pendingSignup } from "@/lib/web/signup-cookie";

/** "Resend email" on the check-your-inbox page. Only for the sign-up this browser started. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false }, 403);
  const waiting = await pendingSignup();
  if (!waiting) return json({ ok: false, error: "We couldn't find your sign-up. Please sign up again." }, 400);
  try {
    const sent = await sendConfirmation(db(), waiting.confirmToken, { visitor: await clientIp() });
    if (sent === "limited") return json({ ok: false, error: "We've already sent it a few times. Check Spam or Promotions, or try again tomorrow." }, 429);
    if (sent === "nothing-to-send") return json({ ok: true, done: true });
    return json({ ok: true });
  } catch (e) {
    console.error("[confirm/resend]", (e as Error).message);
    return json({ ok: false, error: "We couldn't send it just now. Please try again in a minute." }, 502);
  }
}
