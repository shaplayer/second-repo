import type { FeedItem } from "./types";
import { cached, fetchText } from "./http";
import { EDGAR_FORMS, FORM_LABELS, edgarCurrentUrl, edgarSubmissionsUrl } from "./sources";
import { tickerMap } from "./tickers";
import { stripHtml, text, xml } from "./xml";

type TickerLookup = (cik: number) => { ticker: string; name: string } | undefined;

const TITLE_RE = /^(.+?) - (.+?) \((\d{6,10})\) \((\w+)\)\s*$/;

/** Turn an 8-K summary's item list into the headline people care about. */
function eightKHeadline(summaryHtml: string): string | null {
  const items = [...stripHtml(summaryHtml.replace(/<br\s*\/?>/gi, "\n")).matchAll(/Item \d+\.\d+:\s*([^]+?)(?=Item \d+\.\d+:|$)/g)]
    .map((m) => m[1].trim())
    .filter((s) => !/^Financial Statements and Exhibits/i.test(s));
  return items[0] ?? null;
}

/** SEC names are often ALL CAPS ("NORTHWIND CORP"); make them readable. */
export function tidyName(name: string): string {
  const n = name.replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "").trim(); // drop "/DE/" state suffix
  if (n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/[a-z][a-z0-9'&]*/g, (w) => {
    if (/^(of|and|the|de|for)$/.test(w)) return w;
    if (w.length <= 2) return w.toUpperCase();
    return w[0].toUpperCase() + w.slice(1);
  });
}

export function parseEdgarAtom(atom: string, lookup: TickerLookup): FeedItem[] {
  const doc = xml.parse(atom);
  const entries: unknown[] = doc?.feed?.entry ?? [];
  const out: FeedItem[] = [];
  const seen = new Set<string>(); // same filing appears as (Filer) and (Subject)
  for (const e of entries as Record<string, unknown>[]) {
    const m = TITLE_RE.exec(text(e.title));
    if (!m) continue;
    const [, form, rawName, cikStr] = m;
    const cik = Number(cikStr);
    const known = lookup(cik);
    if (!known) continue; // keep only listed public companies
    const links = (e.link as Record<string, string>[] | undefined) ?? [];
    const url = links[0]?.["@_href"];
    if (!url) continue;
    const acc = /accession-number=([\d-]+)/.exec(text(e.id))?.[1] ?? url;
    if (seen.has(acc)) continue;
    seen.add(acc);
    const label = (form.startsWith("8-K") && eightKHeadline(text(e.summary))) || FORM_LABELS[form] || form;
    const company = tidyName(known.name || rawName);
    out.push({
      id: `sec:${acc}`,
      kind: "filing",
      ticker: known.ticker,
      company,
      title: `${company}: ${label}`,
      url,
      source: "SEC EDGAR",
      formType: form,
      publishedAt: new Date(text(e.updated)).toISOString(),
    });
  }
  return out;
}

/** Latest filings across the market (all listed companies). */
export async function fetchLatestFilings(): Promise<FeedItem[]> {
  const map = await tickerMap();
  const lookup: TickerLookup = (cik) => map.byCik.get(cik);
  const results = await Promise.allSettled(
    EDGAR_FORMS.map(async (f) => parseEdgarAtom(await fetchText(edgarCurrentUrl(f)), lookup)),
  );
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") { console.warn("[edgar]", r.reason?.message ?? r.reason); continue; }
    for (const it of r.value) if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
  }
  return items;
}

type Submissions = {
  name: string;
  filings: { recent: {
    accessionNumber: string[]; acceptanceDateTime: string[]; filingDate: string[];
    form: string[]; primaryDocument: string[]; primaryDocDescription: string[];
  } };
};

/** Every recent filing for one ticker, straight from SEC (cached 5 min). */
export async function fetchFilingsForTicker(ticker: string, limit = 20): Promise<FeedItem[]> {
  const map = await tickerMap();
  const hit = map.byTicker.get(ticker);
  if (!hit) return [];
  return cached(`sec:sub:${hit.cik}:${limit}`, 5 * 60 * 1000, async () => {
    const sub = JSON.parse(await fetchText(edgarSubmissionsUrl(hit.cik))) as Submissions;
    const r = sub.filings.recent;
    const out: FeedItem[] = [];
    for (let i = 0; i < r.form.length && out.length < limit; i++) {
      const acc = r.accessionNumber[i];
      const accPath = acc.replace(/-/g, "");
      const doc = r.primaryDocument[i];
      const form = r.form[i];
      const label = FORM_LABELS[form] || r.primaryDocDescription[i] || form;
      out.push({
        id: `sec:${acc}`,
        kind: "filing",
        ticker,
        company: tidyName(sub.name),
        title: `${tidyName(sub.name)}: ${label}`,
        url: doc
          ? `https://www.sec.gov/Archives/edgar/data/${hit.cik}/${accPath}/${doc}`
          : `https://www.sec.gov/Archives/edgar/data/${hit.cik}/${accPath}/${acc}-index.htm`,
        source: "SEC EDGAR",
        formType: form,
        publishedAt: new Date(r.acceptanceDateTime[i] || r.filingDate[i]).toISOString(),
      });
    }
    return out;
  });
}
