import { searchCompanies } from "@/lib/data/companies";
import { db } from "@/lib/db";
import { json } from "@/lib/web/request";

/** Company suggestions while typing: ticker and name only. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60);
  if (!q.trim()) return json({ companies: [] });
  try {
    const found = await searchCompanies(db(), q, 6);
    return json({ companies: found.map((c) => ({ cik: c.cik, ticker: c.ticker, name: c.name, exchange: c.exchange })) });
  } catch (e) {
    console.error("[search]", (e as Error).message);
    return json({ companies: [] }, 503);
  }
}
