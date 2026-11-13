import { createHmac, timingSafeEqual } from "node:crypto";
import { suppressAddress } from "@/lib/alerts/subscriptions";
import { normalizeEmail } from "@/lib/auth/accounts";
import { db } from "@/lib/db";
import { json } from "@/lib/web/request";

/**
 * The email service (Resend) tells us when an address bounced for good or when someone pressed
 * "spam". Either way we stop sending to that address at once, whatever its subscriptions say.
 *
 * Set RESEND_WEBHOOK_SECRET to the signing secret Resend shows for the webhook ("whsec_…").
 * Every call is checked against it; anything unsigned, wrongly signed or older than five minutes is refused.
 */
function verified(req: Request, body: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signatures = req.headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64"));
  return signatures.split(" ").some((s) => {
    const given = Buffer.from(s.replace(/^v1,/, ""));
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export async function POST(req: Request) {
  if (!process.env.RESEND_WEBHOOK_SECRET) return json({ ok: false, error: "The webhook is not set up." }, 503);
  const body = await req.text();
  if (!verified(req, body)) return json({ ok: false }, 401);
  let event: { type?: string; data?: { to?: string[] | string; bounce?: { type?: string; subType?: string } } };
  try {
    event = JSON.parse(body);
  } catch {
    return json({ ok: false }, 400);
  }
  const complaint = event.type === "email.complained";
  // A temporary bounce (full mailbox, server busy) is not a reason to stop for good.
  const hardBounce = event.type === "email.bounced" && (event.data?.bounce?.type ?? "Permanent").toLowerCase() !== "transient";
  if (complaint || hardBounce) {
    const to = Array.isArray(event.data?.to) ? event.data!.to : event.data?.to ? [event.data.to] : [];
    for (const raw of to) {
      const email = normalizeEmail(raw);
      if (email) await suppressAddress(db(), email, complaint ? "complaint" : "bounce", { type: event.type, bounce: event.data?.bounce ?? null });
    }
  }
  return json({ ok: true });
}
