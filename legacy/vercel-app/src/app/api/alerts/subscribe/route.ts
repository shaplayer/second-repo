import { NextResponse } from "next/server";
import { getAccount } from "@/lib/account";
import { confirmEmail, sendEmail } from "@/lib/email";
import { lookup } from "@/lib/sec";
import { DEFAULT_PREFS, addSubscription, type AlertPrefs } from "@/lib/store";

const MAX_TICKERS = 25;
const hits = new Map<string, number[]>();

/** At most 5 sign-ups per hour from one connection, so nobody can flood an inbox with confirm emails. */
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  hits.set(ip, [...recent, now]);
  return recent.length >= 5;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; ticker?: string; prefs?: Partial<AlertPrefs> };
  const email = (body.email ?? "").trim().toLowerCase();
  const ticker = (body.ticker ?? "").trim().toUpperCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!(await lookup(ticker))) return NextResponse.json({ error: "We don't have alerts for that stock yet." }, { status: 400 });
  if (limited(req.headers.get("x-forwarded-for") ?? "local")) {
    return NextResponse.json({ error: "Too many sign-ups from here. Try again in an hour." }, { status: 429 });
  }
  const p = body.prefs ?? {};
  const prefs: AlertPrefs = {
    earnings: p.earnings ?? DEFAULT_PREFS.earnings,
    news: p.news ?? DEFAULT_PREFS.news,
    insider: p.insider ?? DEFAULT_PREFS.insider,
    picks: p.picks ?? false,
    mode: p.mode === "daily" ? "daily" : "instant",
  };

  // Signed in with this same email? Then it's already proven to be theirs, so skip the confirmation email.
  const me = await getAccount().catch(() => null);
  const verified = me?.email.toLowerCase() === email;

  const { sub, isNew } = await addSubscription(email, ticker, prefs, verified, MAX_TICKERS);

  if (sub.confirmed) return NextResponse.json({ status: "added", message: `${ticker} added to your alerts.` });
  try {
    await sendEmail(confirmEmail(sub, ticker));
  } catch (e) {
    return NextResponse.json({ error: `We couldn't send the confirmation email: ${(e as Error).message}` }, { status: 502 });
  }
  return NextResponse.json({ status: isNew ? "confirm" : "confirm-again", message: `Check ${email} and press “Turn on alerts.”` });
}
