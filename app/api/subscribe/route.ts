import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { SMS_CONSENT_TEXT, SMS_WELCOME, toE164US } from "@/lib/sms-consent";
import { smsProvider } from "@/lib/sms";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Basic per-IP throttle (per server process).
const hits = new Map<string, number[]>();
function throttled(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

type Body = { channel?: "email" | "sms"; email?: string; phone?: string; smsConsent?: boolean; source?: string; company?: string };

export async function POST(req: Request) {
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  // Honeypot: real people never fill the hidden "company" field.
  if (body.company) return NextResponse.json({ ok: true });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  const source = String(body.source ?? "home").slice(0, 40);
  const isSms = body.channel === "sms";

  let email: string | null = null;
  let phone: string | null = null;
  if (isSms) {
    phone = toE164US(String(body.phone ?? ""));
    if (!phone) return NextResponse.json({ error: "Please enter a valid US mobile number." }, { status: 400 });
    if (body.smsConsent !== true) return NextResponse.json({ error: "Please check the box to agree to receive text alerts." }, { status: 400 });
  } else {
    email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
  }

  if (throttled(ip)) return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  if (!hasDb()) {
    console.warn("[subscribe] DATABASE_URL not set; sign-up not stored");
    return NextResponse.json({ error: "Sign-ups are almost ready. Please check back shortly." }, { status: 503 });
  }

  try {
    if (email) {
      await db().query(
        `INSERT INTO subscribers (email, ip, user_agent, source) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
        [email, ip, ua, source],
      );
      return NextResponse.json({ ok: true });
    }

    // SMS: record the exact consent wording and time (TCPA), then send the opt-in confirmation.
    const { rows } = await db().query(
      `INSERT INTO subscribers (phone, sms_consent, consent_text, consent_at, ip, user_agent, source)
       VALUES ($1, TRUE, $2, now(), $3, $4, $5)
       ON CONFLICT (phone) DO UPDATE
         SET sms_consent = TRUE, consent_text = EXCLUDED.consent_text, consent_at = now(),
             ip = EXCLUDED.ip, user_agent = EXCLUDED.user_agent, unsubscribed_at = NULL
       RETURNING (xmax = 0) AS inserted`,
      [phone, SMS_CONSENT_TEXT, ip, ua, source],
    );
    const sms = smsProvider();
    if (sms.configured()) {
      try { await sms.send(phone!, SMS_WELCOME); }
      catch (e) { console.error(`[subscribe] welcome SMS via ${sms.name} failed:`, (e as Error).message); }
    } else {
      console.warn(`[subscribe] SMS provider "${sms.name}" not configured; sign-up stored, no welcome text sent`);
    }
    return NextResponse.json({ ok: true, new: rows[0]?.inserted ?? true });
  } catch (e) {
    console.error("[subscribe]", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
