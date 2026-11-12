import { NextResponse } from "next/server";
import { subscriberByToken, updateSubscriber, type AlertPrefs } from "@/lib/store";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; prefs?: AlertPrefs; tickers?: string[] };
  const s = await subscriberByToken(body.token ?? "");
  const saved =
    !!s &&
    (await updateSubscriber(s.token, {
      ...(body.prefs
        ? {
            prefs: {
              earnings: !!body.prefs.earnings,
              news: !!body.prefs.news,
              insider: !!body.prefs.insider,
              picks: !!body.prefs.picks,
              mode: body.prefs.mode === "daily" ? "daily" : "instant",
            },
          }
        : {}),
      // Only ever removes stocks; adding happens through "Get alerts".
      ...(Array.isArray(body.tickers) ? { tickers: s.tickers.filter((t) => body.tickers!.includes(t)) } : {}),
    }));
  return saved ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "This link has expired." }, { status: 404 });
}
