import { NextResponse } from "next/server";
import { dailyBars, fiveDay, lastSession, toDbSymbol } from "@/lib/databento";

const RANGE_DAYS: Record<string, number> = { "1M": 31, "6M": 183, "1Y": 366, "2Y": 731 };

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const symbol = toDbSymbol((params.get("symbol") ?? "").toUpperCase());
  const range = params.get("range") ?? "1D";
  try {
    if (range === "1D" || range === "5D") {
      const bars = range === "1D" ? await lastSession(symbol) : await fiveDay(symbol);
      const daily = (await dailyBars([symbol])).get(symbol) ?? [];
      const firstDay = bars[0]?.t.slice(0, 10);
      const prior = daily.filter((b) => b.t.slice(0, 10) < (firstDay ?? ""));
      return NextResponse.json({
        intraday: true,
        base: range === "1D" && prior.length ? prior[prior.length - 1].c : bars[0]?.o ?? null,
        points: bars.map((b) => ({ t: b.t, c: b.c })),
      });
    }
    const daily = (await dailyBars([symbol])).get(symbol) ?? [];
    const from =
      range === "YTD"
        ? `${new Date().getFullYear()}-01-01`
        : new Date(Date.now() - (RANGE_DAYS[range] ?? 366) * 864e5).toISOString().slice(0, 10);
    const pts = daily.filter((b) => b.t.slice(0, 10) >= from).map((b) => ({ t: b.t, c: b.c }));
    return NextResponse.json({ intraday: false, base: pts[0]?.c ?? null, points: pts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
