import { createHmac, timingSafeEqual } from "node:crypto";
import { siteUrl } from "@/lib/config";
import { db } from "@/lib/db";

/**
 * Text alerts are switched off (plan decision 15) and this site sends no texts. This address exists
 * for one reason: phone numbers that signed up on the old site can still reply STOP to the old number,
 * and that must keep working. A STOP marks every text subscription of that number as unsubscribed and
 * records the number so it can never be texted when texts are added later.
 *
 * Twilio calls this address. Each call is checked against TWILIO_AUTH_TOKEN; without the token set,
 * every call is refused.
 */
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const twiml = (message?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message}</Message>` : ""}</Response>`, { headers: { "content-type": "text/xml" } });

function fromTwilio(req: Request, params: URLSearchParams): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const given = req.headers.get("x-twilio-signature");
  if (!token || !given) return false;
  // Twilio signs the full address it called plus every form field, sorted by name.
  const url = `${siteUrl()}/api/sms/inbound`;
  const data = [...params.keys()].sort().reduce((s, k) => s + k + (params.get(k) ?? ""), url);
  const expected = Buffer.from(createHmac("sha1", token).update(data).digest("base64"));
  const got = Buffer.from(given);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function POST(req: Request) {
  const params = new URLSearchParams(await req.text());
  if (!fromTwilio(req, params)) return new Response("Forbidden", { status: 403 });
  const from = params.get("From") ?? "";
  const word = (params.get("Body") ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!/^\+[1-9][0-9]{6,14}$/.test(from)) return twiml();
  if (STOP_WORDS.has(word)) {
    const pool = db();
    await pool.query(
      `insert into public.suppressions (channel, address, reason, detail) values ('sms', $1, 'stop', $2)
       on conflict (channel, address) do update set reason = 'stop', detail = excluded.detail`,
      [from, JSON.stringify({ word, at: new Date().toISOString() })],
    );
    await pool.query(
      `update public.alert_subscriptions set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null
        where channel = 'sms' and address = $1 and status <> 'unsubscribed'`,
      [from],
    );
    // Twilio sends its own confirmation of the STOP; nothing more is sent from here.
    return twiml();
  }
  if (word === "HELP" || word === "INFO") return twiml("BigStocks: text alerts are paused. Email alerts: bigstocks.com. Reply STOP to opt out.");
  return twiml();
}
