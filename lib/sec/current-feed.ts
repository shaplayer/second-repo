/**
 * The SEC's "latest filings" feed for every filer, newest first. Pure parsing: no network.
 *
 * Each filing is listed once for every party named on it, so an insider trade appears once for the
 * company ("Issuer") and once for each person ("Reporting"). The caller decides which one to keep.
 */
import { decodeEntities } from "./text";

export const currentFeedUrl = (start = 0, count = 100) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&start=${start}&count=${count}&output=atom`;

export type CurrentEntry = {
  accession: string;
  cik: number;
  companyName: string;
  form: string;
  role: "filer" | "issuer" | "reporting" | "subject" | "filed-by" | "other";
  /** ISO, exact: the moment the SEC accepted the filing. */
  acceptedAt: string;
  /** YYYY-MM-DD */
  filedDate: string;
  /** Numbered sections of a "Company news" filing, like "2.02". */
  items: string[];
  indexUrl: string;
};

const ACCESSION = /\b(\d{10}-\d{2}-\d{6})\b/;
/** "8-K - Apple Inc. (0000320193) (Filer)". The company's own name may hold brackets and dashes. */
const TITLE = /^(\S(?:.*?\S)?)\s+-\s+(.+)\s+\((\d{1,10})\)\s+\(([^()]+)\)$/;
const ROLES: Record<string, CurrentEntry["role"]> = {
  filer: "filer",
  issuer: "issuer",
  reporting: "reporting",
  subject: "subject",
  "filed by": "filed-by",
};

const nyDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** The calendar date in New York (where the SEC is) at a moment in time. */
export const newYorkDate = (when: string | Date): string => nyDate.format(typeof when === "string" ? new Date(when) : when);

const inner = (xml: string, tag: string) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i").exec(xml)?.[1] ?? "";
const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
/** Text of an element: the feed escapes its HTML, so decode first, then drop the tags. */
const plain = (s: string) => decodeEntities(unCdata(s)).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");

function archiveUrl(href: string): string | null {
  const h = decodeEntities(href).trim();
  if (h.startsWith("https://www.sec.gov/Archives/")) return h;
  if (h.startsWith("http://www.sec.gov/Archives/")) return "https" + h.slice(4);
  if (h.startsWith("/Archives/")) return "https://www.sec.gov" + h;
  return null;
}

function parseEntry(xml: string): CurrentEntry | null {
  const title = plain(inner(xml, "title")).replace(/\s+/g, " ").trim();
  const m = TITLE.exec(title);
  if (!m) return null;
  const cik = Number(m[3]);
  if (!Number.isSafeInteger(cik) || cik <= 0) return null;
  const companyName = m[2].trim();
  const form = (m[1].trim() || /<category\b[^>]*\bterm\s*=\s*"([^"]+)"/i.exec(xml)?.[1] || "").trim();
  if (!form || !companyName) return null;

  const summary = plain(inner(xml, "summary"));
  const hrefs = [...xml.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((l) => l[1]);
  const accession =
    /accession-number=(\d{10}-\d{2}-\d{6})/.exec(inner(xml, "id"))?.[1] ??
    /AccNo:\s*(\d{10}-\d{2}-\d{6})/.exec(summary)?.[1] ??
    hrefs.map((h) => ACCESSION.exec(h)?.[1]).find(Boolean);
  if (!accession) return null;

  const updated = new Date(plain(inner(xml, "updated")).trim());
  if (!Number.isFinite(updated.getTime())) return null;
  const acceptedAt = updated.toISOString();

  const indexUrl =
    hrefs.map(archiveUrl).find((u): u is string => u !== null) ??
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${accession}-index.htm`;

  const items: string[] = [];
  for (const i of summary.matchAll(/\bItem\s+(\d{1,2}\.\d{2})\b/gi)) if (!items.includes(i[1])) items.push(i[1]);

  return {
    accession,
    cik,
    companyName,
    form,
    role: ROLES[m[4].trim().toLowerCase()] ?? "other",
    acceptedAt,
    filedDate: /Filed:\s*(\d{4}-\d{2}-\d{2})/.exec(summary)?.[1] ?? newYorkDate(updated),
    items,
    indexUrl,
  };
}

/** Every entry that can be read, in the feed's order. An entry that cannot be read is left out. */
export function parseCurrentFeed(xml: string): CurrentEntry[] {
  const out: CurrentEntry[] = [];
  for (const m of String(xml ?? "").matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)) {
    try {
      const entry = parseEntry(m[1]);
      if (entry) out.push(entry);
    } catch {
      // One odd entry never stops the rest.
    }
  }
  return out;
}
