import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { PACKAGES } from "@/lib/advertise";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

const hits = new Map<string, number[]>();
function throttled(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (b.website) return NextResponse.json({ ok: true }); // honeypot

  const name = clip(b.name, 120);
  const company = clip(b.company, 160);
  const email = clip(b.email, 254).toLowerCase();
  const ticker = clip(b.ticker, 12).toUpperCase().replace(/^\$/, "") || null;
  const phone = clip(b.phone, 40) || null;
  const pkg = PACKAGES.some((p) => p.id === b.package) ? String(b.package) : null;
  const message = clip(b.message, 4000) || null;

  if (!name || !company) return NextResponse.json({ error: "Please add your name and company." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (throttled(ip)) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  if (!hasDb()) {
    console.warn("[inquiry] DATABASE_URL not set; inquiry not stored:", { name, company, email, pkg });
    return NextResponse.json({ error: "Our form is almost ready. Please email us in the meantime." }, { status: 503 });
  }
  try {
    await db().query(
      `INSERT INTO inquiries (name, company, ticker, email, phone, package, message, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [name, company, ticker, email, phone, pkg, message, ip],
    );
    console.log(`[inquiry] ${company} (${ticker ?? "-"}) ${email} package=${pkg ?? "-"}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[inquiry]", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
