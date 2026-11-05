import { db, hasDb } from "@/lib/db";
import { START_WORDS, STOP_WORDS, smsProvider } from "@/lib/sms";

export const dynamic = "force-dynamic";

/**
 * Inbound-message webhook: POST https://bigstocks.com/api/sms/inbound
 * The active provider (SMS_PROVIDER) authenticates and parses the request.
 * STOP / START replies are recorded so opt-outs are honored here too.
 */
export async function POST(req: Request) {
  const provider = smsProvider();
  if (!provider.parseInbound) return new Response("Inbound not supported by this SMS provider", { status: 404 });
  const msg = await provider.parseInbound(req);
  if (!msg) return new Response("Unauthorized", { status: 403 });

  const word = msg.body.trim().toUpperCase();
  if (hasDb()) {
    if (STOP_WORDS.includes(word)) {
      await db().query(`UPDATE subscribers SET unsubscribed_at = now() WHERE phone = $1`, [msg.from]);
      console.log("[sms] opt-out", msg.from);
    } else if (START_WORDS.includes(word)) {
      await db().query(`UPDATE subscribers SET unsubscribed_at = NULL WHERE phone = $1 AND sms_consent`, [msg.from]);
      console.log("[sms] opt-in again", msg.from);
    }
  }
  return provider.inboundResponse?.() ?? Response.json({ ok: true });
}
