import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";

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

export async function POST(req: Request) {
  let body: { email?: string; source?: string; company?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  // Honeypot: real people never fill the hidden "company" field.
  if (body.company) return NextResponse.json({ ok: true });

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (throttled(ip)) return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });

  if (!hasDb()) {
    console.warn("[subscribe] DATABASE_URL not set; sign-up not stored:", email);
    return NextResponse.json({ error: "Sign-ups are almost ready. Please check back shortly." }, { status: 503 });
  }
  try {
    await db().query(
      `INSERT INTO subscribers (email, ip, user_agent, source) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
      [email, ip, req.headers.get("user-agent")?.slice(0, 300) ?? null, String(body.source ?? "home").slice(0, 40)],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[subscribe]", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
