import { NextResponse } from "next/server";
import { companies } from "@/lib/sec";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toUpperCase().replace(/^\$/, "");
  if (!q) return NextResponse.json([]);
  const all = [...(await companies()).values()];
  const score = (c: (typeof all)[number]) => {
    const name = c.name.toUpperCase();
    if (c.ticker === q) return 0;
    if (c.ticker.startsWith(q)) return 1 + c.ticker.length / 10;
    if (name.startsWith(q)) return 3;
    if (name.includes(" " + q)) return 4;
    if (name.includes(q)) return 5;
    return Infinity;
  };
  const hits = all
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s < Infinity)
    .sort((a, b) => a.s - b.s)
    .slice(0, 8)
    .map(({ c }) => ({ ticker: c.ticker, name: c.name, exchange: c.exchange }));
  return NextResponse.json(hits);
}
