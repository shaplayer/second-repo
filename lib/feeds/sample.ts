/**
 * DEVELOPMENT ONLY. Fictional companies used to preview the UI when the
 * real feeds can't be reached (FEED_SAMPLE=1). Never enable in production.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FeedItem } from "./types";
import { parseEdgarAtom } from "./edgar";
import { parseRss } from "./rss";

const SAMPLE_COMPANIES: Record<number, { ticker: string; name: string }> = {
  9000001: { ticker: "NWBT", name: "Northwind Biotherapeutics, Inc." },
  9000002: { ticker: "HGRD", name: "Halcyon Grid Systems Corp" },
  9000003: { ticker: "CPLMF", name: "Copperline Minerals Ltd" },
  9000004: { ticker: "VORB", name: "Vantage Orbital Inc." },
  9000005: { ticker: "BWPY", name: "Brightwater Payments, Inc." },
};

export const sampleEnabled = () => process.env.FEED_SAMPLE === "1" && process.env.NODE_ENV !== "production";

export function sampleItems(): FeedItem[] {
  const dir = path.join(process.cwd(), "lib/feeds/fixtures");
  const filings = parseEdgarAtom(readFileSync(path.join(dir, "edgar-8k.xml"), "utf8"), (cik) => SAMPLE_COMPANIES[cik]);
  const press = parseRss(readFileSync(path.join(dir, "press.xml"), "utf8"), "Sample Wire");
  const items = [...filings, ...press].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  // Shift so the newest item is ~3 minutes old: realistic "time ago" in previews.
  const shift = Date.now() - 3 * 60_000 - new Date(items[0]?.publishedAt ?? Date.now()).getTime();
  return items.map((it) => ({ ...it, publishedAt: new Date(new Date(it.publishedAt).getTime() + shift).toISOString() }));
}
