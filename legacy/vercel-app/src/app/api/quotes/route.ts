import { NextResponse } from "next/server";
import { quoteFromDaily, recentDaily, toDbSymbol } from "@/lib/databento";
import { companies } from "@/lib/sec";

export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);
  if (!symbols.length) return NextResponse.json([]);
  try {
    const [bars, cos] = await Promise.all([recentDaily(symbols.map(toDbSymbol)), companies()]);
    return NextResponse.json(
      symbols.map((s) => ({ ...quoteFromDaily(s, bars.get(toDbSymbol(s))), symbol: s, name: cos.get(s)?.name ?? s })),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
