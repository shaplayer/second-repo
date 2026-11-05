import { db, hasDb } from "@/lib/db";
import { START_WORDS, STOP_WORDS, validTwilioSignature } from "@/lib/sms";

export const dynamic = "force-dynamic";

/**
 * Twilio inbound-message webhook. Set it in Twilio as
 *   POST https://bigstocks.com/api/sms/inbound
 * Records STOP / START so opt-outs are honored in our database too.
 * Twilio's built-in Advanced Opt-Out sends the STOP/HELP replies, so we answer with empty TwiML.
 */
const twiml = () => new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml" } });

export async function POST(req: Request) {
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  // Twilio signs the public URL it called; behind Nginx req.url is the internal one.
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const publicUrl = site ? `${site}/api/sms/inbound` : req.url;
  if (!validTwilioSignature(publicUrl, params, req.headers.get("x-twilio-signature"))) {
    return new Response("Invalid signature", { status: 403 });
  }

  const from = params.From;
  const word = (params.Body || "").trim().toUpperCase();
  if (hasDb() && from) {
    if (STOP_WORDS.includes(word)) {
      await db().query(`UPDATE subscribers SET unsubscribed_at = now() WHERE phone = $1`, [from]);
      console.log("[sms] opt-out", from);
    } else if (START_WORDS.includes(word)) {
      await db().query(`UPDATE subscribers SET unsubscribed_at = NULL WHERE phone = $1 AND sms_consent`, [from]);
      console.log("[sms] opt-in again", from);
    }
  }
  return twiml();
}
