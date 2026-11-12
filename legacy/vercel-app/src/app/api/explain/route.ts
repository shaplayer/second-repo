import { NextResponse } from "next/server";
import { lookup, recentFilings } from "@/lib/sec";
import { summarize } from "@/lib/summarize";

const hits = new Map<string, number[]>();

/** Plain-English summary of one filing, made on request and saved for everyone after. */
export async function POST(req: Request) {
  const { ticker, accession } = (await req.json().catch(() => ({}))) as { ticker?: string; accession?: string };
  const co = ticker ? await lookup(ticker) : null;
  if (!co || !accession) return NextResponse.json({ error: "Unknown filing." }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for") ?? "local";
  const recent = (hits.get(ip) ?? []).filter((t) => Date.now() - t < 3600_000);
  if (recent.length >= 30) return NextResponse.json({ error: "Too many summaries requested. Try again later." }, { status: 429 });
  hits.set(ip, [...recent, Date.now()]);

  const filing = (await recentFilings(co.cik)).find((f) => f.accession === accession);
  if (!filing) return NextResponse.json({ error: "Unknown filing." }, { status: 404 });
  try {
    return NextResponse.json(await summarize({ ...filing, cik: co.cik, ticker: co.ticker, companyName: co.name }));
  } catch (e) {
    return NextResponse.json({ error: `Couldn't summarize this filing: ${(e as Error).message}` }, { status: 502 });
  }
}
