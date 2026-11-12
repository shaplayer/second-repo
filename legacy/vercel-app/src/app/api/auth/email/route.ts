import { NextResponse } from "next/server";
import { sendEmail, signInEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase/server";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const hits = new Map<string, number[]>();

function limited(key: string, max: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3600_000);
  hits.set(key, [...recent, now]);
  return recent.length >= max;
}

/** Email a one-click sign-in link. New emails get an account automatically: signing in is signing up. */
export async function POST(req: Request) {
  const { email: raw, next } = (await req.json().catch(() => ({}))) as { email?: string; next?: string };
  const email = (raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (limited("ip:" + (req.headers.get("x-forwarded-for") ?? "local"), 10) || limited("email:" + email, 4)) {
    return NextResponse.json({ error: "Too many sign-in emails. Try again in an hour." }, { status: 429 });
  }
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  try {
    const admin = supabaseAdmin();
    // Create the account if it's new; "already registered" just means they're signing in again.
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error && !/already|exists|registered/i.test(created.error.message)) throw created.error;
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    const link = `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(safeNext)}`;
    await sendEmail(signInEmail(email, link));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: `We couldn't send your sign-in link: ${(e as Error).message}` }, { status: 502 });
  }
}
