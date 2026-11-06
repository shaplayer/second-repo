import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { PACKAGES } from "@/lib/advertise";
import { emailProvider, notifyRecipients } from "@/lib/email";
import { inquiryEmail, type Inquiry } from "@/lib/email/inquiry";

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

  const inquiry: Inquiry = { name, company, email, ticker, phone, package: pkg, message };
  let saved = false;
  if (hasDb()) {
    try {
      const { rows } = await db().query(
        `INSERT INTO inquiries (name, company, ticker, email, phone, package, message, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [name, company, ticker, email, phone, pkg, message, ip],
      );
      inquiry.id = String(rows[0].id);
      saved = true;
    } catch (e) {
      console.error("[inquiry] db:", (e as Error).message);
    }
  }
  const notified = await notifyTeam(inquiry);
  console.log(`[inquiry] ${company} (${ticker ?? "-"}) package=${pkg ?? "-"} saved=${saved} emailed=${notified}`);

  if (!saved && !notified) {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Email the team. Never throws: the inquiry is already saved if the DB is set up. */
async function notifyTeam(q: Inquiry): Promise<boolean> {
  const to = notifyRecipients();
  const mail = emailProvider();
  if (!to.length || !mail.configured()) {
    console.warn(`[inquiry] email not sent: ${!to.length ? "INQUIRY_NOTIFY_TO is empty" : `EMAIL_PROVIDER "${mail.name}" not configured`}`);
    return false;
  }
  try {
    await mail.send(inquiryEmail(q, to));
    if (mail.name === "console") return false; // logged only, not delivered
    if (q.id && hasDb()) await db().query(`UPDATE inquiries SET notified_at = now() WHERE id = $1`, [q.id]).catch(() => {});
    return true;
  } catch (e) {
    console.error(`[inquiry] email via ${mail.name} failed:`, (e as Error).message);
    return false;
  }
}
