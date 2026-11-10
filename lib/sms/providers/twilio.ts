import { createHmac, timingSafeEqual } from "node:crypto";
import twilio from "twilio";
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
  configured: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET && process.env.TWILIO_FROM_NUMBER),
  async send(to, body) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;
    const from = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !apiKey || !apiSecret || !from) {
      throw new Error("Twilio SMS configuration is incomplete");
    }

    const client = twilio(apiKey, apiSecret, { accountSid });

    const message = await client.messages.create({
      body: process.env.TWILIO_TRIAL_MODE ? "sms_appointment_reminders" : body,
      from,
      to,
    });

    if (!message.sid) {
      throw new Error("Twilio send failed: missing message SID");
    }

    console.log(message);

    return { id: message.sid };
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
