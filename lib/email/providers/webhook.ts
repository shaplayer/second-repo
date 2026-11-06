import type { EmailProvider } from "../types";

/**
 * Generic: hands each email to YOUR service (any vendor).
 * POST $EMAIL_WEBHOOK_URL   Authorization: Bearer $EMAIL_WEBHOOK_SECRET
 * {"to":["a@b.com"],"subject":"...","text":"...","html":"...","replyTo":"..."}  -> 2xx
 */
export const webhookEmail: EmailProvider = {
  name: "webhook",
  configured: () => Boolean(process.env.EMAIL_WEBHOOK_URL && process.env.EMAIL_WEBHOOK_SECRET),
  async send(m) {
    const res = await fetch(process.env.EMAIL_WEBHOOK_URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.EMAIL_WEBHOOK_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(m),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Email webhook ${res.status}`);
    const d = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: d.id ?? "" };
  },
};
