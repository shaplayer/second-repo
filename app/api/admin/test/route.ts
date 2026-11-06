import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { buildMessages, type Tier } from "@/lib/broadcast";
import { emailProvider } from "@/lib/email";
import { smsProvider } from "@/lib/sms";
import { normalizeTicker } from "@/lib/feeds/tickers";
import { toE164US } from "@/lib/sms-consent";

export const dynamic = "force-dynamic";

/** Send yourself a preview of an alert. Nothing is logged on the track record. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    ticker?: string; price?: number | string; tier?: Tier; message?: string; sponsored?: boolean; sponsorComp?: string;
    email?: string; phone?: string;
  };
  const ticker = normalizeTicker(String(b.ticker ?? ""));
  const price = Number(b.price);
  if (!ticker || !(price > 0)) return NextResponse.json({ error: "Enter a ticker and price first." }, { status: 400 });
  const m = buildMessages({ ticker, price, tier: b.tier === "premium" ? "premium" : "free", message: b.message, sponsored: b.sponsored, sponsorComp: b.sponsorComp, at: new Date() });
  const sent: string[] = [];
  try {
    if (b.email?.trim()) {
      await emailProvider().send({ to: [b.email.trim()], subject: `[TEST] ${m.subject}`, text: m.text.replaceAll("{{UNSUB}}", "#"), html: m.html.replaceAll("{{UNSUB}}", "#") });
      sent.push("email");
    }
    const phone = b.phone ? toE164US(b.phone) : null;
    if (phone) { await smsProvider().send(phone, `[TEST] ${m.sms}`); sent.push("text"); }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  if (!sent.length) return NextResponse.json({ error: "Enter your email or phone to get the test." }, { status: 400 });
  return NextResponse.json({ ok: true, sent });
}
