import { createHmac, timingSafeEqual } from "node:crypto";
import type { SmsProvider } from "../types";

/**
 * Example adapter: Twilio (SMS_PROVIDER=twilio).
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER.
 * Use it as a template for other vendors.
 */
function validSignature(url: string, params: Record<string, string>, signature: string | null) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const a = Buffer.from(createHmac("sha1", token).update(data).digest("base64"));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const twilioProvider: SmsProvider = {
  name: "twilio",
  configured: () =>
    Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER)),
  async send(to, body) {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const form = new URLSearchParams({ To: to, Body: body });
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
    else form.set("From", process.env.TWILIO_FROM_NUMBER!);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok || !data.sid) throw new Error(`Twilio ${res.status}: ${data.message ?? "send failed"}`);
    return { id: data.sid };
  },
  async parseInbound(req) {
    const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const url = site ? `${site}/api/sms/inbound` : req.url; // Twilio signs the public URL
    if (!validSignature(url, params, req.headers.get("x-twilio-signature"))) return null;
    return params.From ? { from: params.From, body: params.Body ?? "" } : null;
  },
  inboundResponse: () =>
    new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { "Content-Type": "text/xml" } }),
};
