/**
 * Send one text alert to every opted-in SMS subscriber.
 *   npm run sms:broadcast -- "NWBT pre-market alert: ..."           # dry run (default)
 *   npm run sms:broadcast -- "NWBT pre-market alert: ..." --send    # actually send
 * Skips anyone who replied STOP. Appends "Reply STOP to opt out" if missing.
 * Sponsored alerts must include the compensation disclosure in the text.
 */
import { db } from "../lib/db";
import { smsProvider } from "../lib/sms";
import { SMS_FOOTER } from "../lib/sms-consent";

const RATE_PER_SEC = Number(process.env.SMS_RATE_PER_SEC ?? 10); // match your provider throughput

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes("--send");
  const text = args.filter((a) => a !== "--send").join(" ").trim();
  if (!text) throw new Error('Usage: npm run sms:broadcast -- "message" [--send]');
  const body = /reply stop/i.test(text) ? text : `${text}\n${SMS_FOOTER}`;

  const { rows } = await db().query<{ phone: string }>(
    `SELECT phone FROM subscribers WHERE phone IS NOT NULL AND sms_consent AND unsubscribed_at IS NULL ORDER BY id`,
  );
  console.log(`Message (${body.length} chars, ~${Math.ceil(body.length / 153)} segment(s)):\n---\n${body}\n---`);
  console.log(`Recipients: ${rows.length}`);
  if (!send) { console.log("Dry run. Add --send to deliver."); process.exit(0); }
  const sms = smsProvider();
  if (!sms.configured()) throw new Error(`SMS provider "${sms.name}" is not configured`);
  console.log(`Sending via ${sms.name}…`);

  let ok = 0, failed = 0;
  const gap = 1000 / RATE_PER_SEC;
  for (const r of rows) {
    const started = Date.now();
    try { await sms.send(r.phone, body); ok++; }
    catch (e) { failed++; console.error(r.phone.slice(0, -4) + "XXXX", (e as Error).message); }
    const wait = gap - (Date.now() - started);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  }
  console.log(`Done. Sent ${ok}, failed ${failed}.`);
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
