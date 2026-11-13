/**
 * Reading a newswire's RSS feed: the headline, the link, the time, and the ticker the release names.
 * Pure parsing: no network, no database.
 */
import { XMLParser } from "fast-xml-parser";

export type PressItem = {
  title: string;
  /** Always https. */
  url: string;
  /** ISO */
  publishedAt: string;
  /** As the release wrote it, upper case: "NWBT", "BRK.B". */
  ticker: string;
  /** False when the ticker was given for a market outside the US: it must not be matched to a US company. */
  usListed: boolean;
  /** The company's name as the release gave it, when it could be found. */
  company: string | null;
  /** The feed's short description, as plain text. */
  description: string;
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  htmlEntities: true,
  isArray: (name) => ["entry", "item", "category", "link"].includes(name),
});

/** Text content of a parsed node (string, number, or {#text}). */
function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) return String((node as Record<string, unknown>)["#text"]);
  return "";
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

// "(NASDAQ: ABCD)", "NYSE American: XYZ", "OTCQB:ABCD", "Nasdaq: ABCD, ABCDW", "(NYSE: BRK.B)"
const US_MARKET =
  "NASDAQ(?:\\s?(?:GS|GM|CM))?|Nasdaq(?:\\s(?:Global|Capital)\\s(?:Select\\s)?Market)?|NYSE(?:\\s(?:American|Arca|MKT))?|NYSEAMERICAN|AMEX|OTCQX|OTCQB|OTC\\sPink|OTC(?:\\sMarkets)?|Cboe(?:\\sBZX)?";
const OTHER_MARKET = "TSXV?|CSE";
const TICKER_RE = new RegExp(`\\b(?:(${US_MARKET})|(${OTHER_MARKET}))\\s*:\\s*\\$?([A-Z]{1,5}(?:[.-][A-Z]{1,2})?)\\b`, "g");

/** Every "MARKET: TICKER" in the texts, in order. */
export function findTickers(...texts: string[]): { ticker: string; usListed: boolean }[] {
  const out: { ticker: string; usListed: boolean }[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(TICKER_RE)) out.push({ ticker: m[3].toUpperCase(), usListed: m[1] !== undefined });
  }
  return out;
}

/** The ticker a release names: the first one on a US market, else the first one of any market. */
export function extractTicker(...texts: string[]): string | null {
  const found = findTickers(...texts);
  return (found.find((f) => f.usListed) ?? found[0])?.ticker ?? null;
}

/** The company is usually the text right before "(NASDAQ: X)", after the dateline. */
function extractCompany(desc: string): string | null {
  const m = /([A-Z][\w&.,'\- ]{1,80}?)\s*\((?:[^()]*?:\s*\$?[A-Z]{1,5}[^()]*)\)/.exec(desc);
  if (!m) return null;
  const name = m[1].replace(/^.*?(?:\(\w+\)|--|—|–|\/PRNewswire\/|\/GLOBE NEWSWIRE\/|\(BUSINESS WIRE\)|\/ACCESS Newswire\/)\s*/i, "").trim();
  return name || null;
}

/**
 * The feed's releases that name a public company's ticker. Items with no title, no https link, no
 * readable time or no ticker are left out. Never throws: an unreadable feed gives an empty list.
 */
export function parsePressRss(body: string): PressItem[] {
  let doc: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    doc = xml.parse(body);
  } catch {
    return [];
  }
  const items: Record<string, unknown>[] = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const out: PressItem[] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(items) ? items : []) {
    try {
      const title = stripHtml(text(it.title));
      const linkNode = it.link as unknown;
      const first = Array.isArray(linkNode) ? linkNode[0] : linkNode;
      const url = (String((first as Record<string, unknown> | null)?.["@_href"] ?? "") || text(first)).trim() || text(it.guid).trim();
      if (!title || !/^https:\/\/[^\s]+$/.test(url) || seen.has(url)) continue;
      const description = stripHtml(text(it.description) || text(it.summary) || text(it["content:encoded"]));
      const categories = (Array.isArray(it.category) ? (it.category as unknown[]) : []).map(text).join(" ");
      const found = findTickers(title, description, categories);
      const hit = found.find((f) => f.usListed) ?? found[0];
      if (!hit) continue; // only news that names a public company
      const date = new Date(text(it.pubDate) || text(it["dc:date"]) || text(it.updated) || text(it.published));
      if (!Number.isFinite(date.getTime())) continue;
      seen.add(url);
      out.push({ title, url, publishedAt: date.toISOString(), ticker: hit.ticker, usListed: hit.usListed, company: extractCompany(description), description });
    } catch {
      // One odd item never stops the rest.
    }
  }
  return out;
}
