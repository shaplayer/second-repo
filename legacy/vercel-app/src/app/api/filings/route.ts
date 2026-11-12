import { NextResponse } from "next/server";
import { explain, isAnnouncement } from "@/lib/plain";
import { lookup, recentFilings } from "@/lib/sec";

/** Latest announcements across several stocks, newest first. */
export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);
  const lists = await Promise.all(
    symbols.map(async (ticker) => {
      const co = await lookup(ticker);
      if (!co) return [];
      const filings = await recentFilings(co.cik).catch(() => []);
      return filings
        .filter(isAnnouncement)
        .slice(0, 5)
        .map(explain)
        .filter((f) => f !== null)
        .map((f) => ({ ...f, ticker }));
    }),
  );
  const merged = lists.flat().sort((a, b) => (a.accepted < b.accepted ? 1 : -1)).slice(0, 10);
  return NextResponse.json(merged);
}
