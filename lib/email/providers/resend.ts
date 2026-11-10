import type { EmailMessage, EmailProvider } from "../types";

/**
 * Resend (resend.com) over its HTTP API.
 * Env: RESEND_API_KEY, EMAIL_FROM (an address on a domain you verified in Resend).
 * Alert broadcasts use the batch endpoint: up to 100 emails per request.
 */
const API = "https://api.resend.com";

function body(m: EmailMessage) {
  return {
    from: process.env.EMAIL_FROM,
    to: m.to,
    subject: m.subject,
    text: m.text,
    ...(m.html ? { html: m.html } : {}),
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    ...(m.headers ? { headers: m.headers } : {}),
  };
}

async function call(path: string, payload: unknown, attempt = 0): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  // Rate limited: wait and retry a few times.
  if (res.status === 429 && attempt < 4) {
    const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
    return call(path, payload, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(data as { message?: string }).message ?? res.statusText}`);
  return data;
}

export const resendEmail: EmailProvider = {
  name: "resend",
  configured: () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  async send(m) {
    const d = (await call("/emails", body(m))) as { id?: string };
    return { id: d.id ?? "" };
  },
  async sendBatch(ms) {
    for (let i = 0; i < ms.length; i += 100) await call("/emails/batch", ms.slice(i, i + 100).map(body));
  },
};
