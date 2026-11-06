import { createHash } from "node:crypto";
import type { FeedItem } from "./types";
import { fetchFeed } from "./http";
import { ACTIVE_PRESS_FEEDS as PRESS_FEEDS } from "./sources";
import { stripHtml, text, xml } from "./xml";

// "(NASDAQ: ABCD)", "NYSE American: XYZ", "OTCQB:ABCD", "Nasdaq: ABCD, ABCDW"
const EXCHANGE_TICKER_RE =
  /\b(?:NASDAQ(?:\s?(?:GS|GM|CM))?|Nasdaq(?:\s(?:Global|Capital)\s(?:Select\s)?Market)?|NYSE(?:\s(?:American|Arca|MKT))?|NYSEAMERICAN|AMEX|OTCQX|OTCQB|OTC\sPink|OTC(?:\sMarkets)?|Cboe(?:\sBZX)?|TSXV?|CSE)\s*:\s*\$?([A-Z]{1,5}(?:\.[A-Z]{1,2})?)\b/;

export function extractTicker(...texts: string[]): string | null {
  for (const t of texts) {
    const m = EXCHANGE_TICKER_RE.exec(t);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** Company is usually the dateline lead or the text right before "(NASDAQ: X)". */
function extractCompany(desc: string): string | null {
  const m = /([A-Z][\w&.,'\- ]{1,80}?)\s*\((?:[^()]*?:\s*\$?[A-Z]{1,5}[^()]*)\)/.exec(desc);
  if (!m) return null;
  return m[1].replace(/^.*?(?:\(\w+\)|--|—|–|\/PRNewswire\/|\/GLOBE NEWSWIRE\/|\(BUSINESS WIRE\)|\/ACCESS Newswire\/)\s*/i, "").trim() || null;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

export function parseRss(body: string, source: string): FeedItem[] {
  const doc = xml.parse(body);
  const items: Record<string, unknown>[] = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const out: FeedItem[] = [];
  for (const it of items) {
    const title = stripHtml(text(it.title));
    const linkNode = it.link as unknown;
    const url =
      (Array.isArray(linkNode) ? (linkNode[0]?.["@_href"] ?? text(linkNode[0])) : text(linkNode)).trim() ||
      text(it.guid).trim();
    if (!title || !/^https?:\/\//.test(url)) continue;
    const desc = stripHtml(text(it.description) || text(it.summary) || text(it["content:encoded"]));
    const categories = ((it.category as unknown[]) ?? []).map(text).join(" ");
    const ticker = extractTicker(title, desc, categories);
    if (!ticker) continue; // only public-company news
    const date = new Date(text(it.pubDate) || text(it["dc:date"]) || text(it.updated) || text(it.published));
    if (!Number.isFinite(date.getTime())) continue;
    out.push({
      id: `pr:${hash(url)}`,
      kind: "press",
      ticker,
      company: extractCompany(desc),
      title,
      url,
      source,
      formType: null,
      publishedAt: date.toISOString(),
    });
  }
  return out;
}

export async function fetchPressReleases(): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    PRESS_FEEDS.map(async (f) => parseRss(await fetchFeed(f.url, 15000), f.source)),
  );
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") { console.warn(`[rss] ${PRESS_FEEDS[i].url}:`, r.reason?.message ?? r.reason); return; }
    for (const it of r.value) if (!seen.has(it.url)) { seen.add(it.url); items.push(it); }
  });
  return items;
}
