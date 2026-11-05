import { timingSafeEqual } from "node:crypto";
import type { SmsProvider } from "../types";

/**
 * Generic provider: hands every outgoing text to YOUR service, so your devs can
 * use any SMS vendor without touching this codebase.
 *
 * Outgoing:  POST $SMS_WEBHOOK_URL
 *            Authorization: Bearer $SMS_WEBHOOK_SECRET
 *            {"to":"+15555550123","body":"..."}   -> respond 2xx with {"id":"..."}
 * Incoming:  your service POSTs to https://bigstocks.com/api/sms/inbound
 *            with the same Bearer secret and {"from":"+15555550123","body":"STOP"}
 */
const secret = () => process.env.SMS_WEBHOOK_SECRET ?? "";

function bearerOk(req: Request) {
  const want = Buffer.from(`Bearer ${secret()}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  return secret().length >= 16 && want.length === got.length && timingSafeEqual(want, got);
}

export const webhookProvider: SmsProvider = {
  name: "webhook",
  configured: () => Boolean(process.env.SMS_WEBHOOK_URL && secret()),
  async send(to, body) {
    const res = await fetch(process.env.SMS_WEBHOOK_URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, body }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`SMS webhook ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: data.id ?? "" };
  },
  async parseInbound(req) {
    if (!bearerOk(req)) return null;
    const d = (await req.json().catch(() => null)) as { from?: string; body?: string } | null;
    return d?.from ? { from: d.from, body: d.body ?? "" } : null;
  },
};
