import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { emailProvider } from "@/lib/email";
import { confirmEmail } from "@/lib/follow/messages";
import { normalizeTicker } from "@/lib/feeds/tickers";
import { smsCombinedConsentText, smsFollowConsentText, smsFollowWelcome, toE164US } from "@/lib/sms-consent";
import { smsProvider } from "@/lib/sms";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hits = new Map<string, number[]>();
function throttled(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

type Body = { ticker?: string; channel?: string; email?: string; phone?: string; smsConsent?: boolean; company?: string; consent?: "combined" };

/**
 * Follow one company: POST {ticker, channel: "email"|"sms", email | phone, smsConsent}
 * Email follows need a click on the confirmation link (double opt-in); SMS follows need the consent box.
 */
export async function POST(req: Request) {
  let b: Body;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (b.company) return NextResponse.json({ ok: true }); // honeypot

  const ticker = normalizeTicker(b.ticker);
  if (!ticker) return NextResponse.json({ error: "Unknown ticker." }, { status: 400 });
  const channel = b.channel === "sms" ? "sms" : "email";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Store the exact wording the person saw (the bell pop-up uses one combined checkbox).
  const smsText = b.consent === "combined" ? smsCombinedConsentText(ticker) : smsFollowConsentText(ticker);

  let email: string | null = null;
  let phone: string | null = null;
  if (channel === "email") {
    email = String(b.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  } else {
    phone = toE164US(String(b.phone ?? ""));
    if (!phone) return NextResponse.json({ error: "Please enter a valid US mobile number." }, { status: 400 });
    if (b.smsConsent !== true) return NextResponse.json({ error: "Please check the box to agree to receive texts." }, { status: 400 });
  }
  if (throttled(ip)) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  if (!hasDb()) return NextResponse.json({ error: "Company alerts are almost ready. Please check back shortly." }, { status: 503 });

  try {
    // Find or create the person. A new person here is NOT added to the general daily list.
    const sub = channel === "email"
      ? await db().query(
          `INSERT INTO subscribers (email, ip, user_agent, source, general_alerts) VALUES ($1,$2,$3,'follow',FALSE)
           ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
          [email, ip, req.headers.get("user-agent")?.slice(0, 300) ?? null],
        )
      : await db().query(
          `INSERT INTO subscribers (phone, sms_consent, consent_text, consent_at, ip, user_agent, source, general_alerts)
           VALUES ($1, TRUE, $2, now(), $3, $4, 'follow', FALSE)
           ON CONFLICT (phone) DO UPDATE SET sms_consent = TRUE, unsubscribed_at = NULL RETURNING id`,
          [phone, smsText, ip, req.headers.get("user-agent")?.slice(0, 300) ?? null],
        );
    const subscriberId = sub.rows[0].id;

    const token = randomBytes(24).toString("base64url");
    const consent = channel === "sms" ? smsText : null;
    const { rows } = await db().query(
      `INSERT INTO ticker_follows (subscriber_id, ticker, channel, token, consent_text, consent_at, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, CASE WHEN $3 = 'sms' THEN now() ELSE NULL END)
       ON CONFLICT (subscriber_id, ticker, channel) DO UPDATE
         SET unsubscribed_at = NULL,
             consent_text = COALESCE(EXCLUDED.consent_text, ticker_follows.consent_text),
             consent_at = COALESCE(EXCLUDED.consent_at, ticker_follows.consent_at),
             confirmed_at = CASE WHEN EXCLUDED.channel = 'sms' THEN now() ELSE ticker_follows.confirmed_at END
       RETURNING token, confirmed_at, unsubscribed_at`,
      [subscriberId, ticker, channel, token, consent],
    );
    const f = rows[0];

    if (channel === "email") {
      if (f.confirmed_at) return NextResponse.json({ ok: true, status: "following" });
      const mail = emailProvider();
      if (!mail.configured()) return NextResponse.json({ error: "Email alerts are almost ready. Please check back shortly." }, { status: 503 });
      await mail.send(confirmEmail(ticker, email!, f.token));
      return NextResponse.json({ ok: true, status: "confirm" });
    }

    const sms = smsProvider();
    if (sms.configured()) {
      try { await sms.send(phone!, smsFollowWelcome(ticker)); }
      catch (e) { console.error("[follow] welcome SMS failed:", (e as Error).message); }
    }
    return NextResponse.json({ ok: true, status: "following" });
  } catch (e) {
    console.error("[follow]", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
