import { cached } from "./cache";

// SEC EDGAR: free, official company data. The SEC asks every client to send a
// User-Agent with a contact email and to stay under 10 requests per second.
const UA = process.env.SEC_USER_AGENT || "BigStocks.com admin@bigstocks.com";

/** revalidate: seconds the response may be shared from Vercel's cache across all visitors (0 = always fresh). */
async function secJson<T>(url: string, revalidate = 0): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    ...(revalidate ? { next: { revalidate } } : { cache: "no-store" as const }),
  });
  if (!res.ok) throw new Error(`SEC request failed (${res.status}): ${url}`);
  return res.json() as Promise<T>;
}

export type Company = { cik: number; name: string; ticker: string; exchange: "Nasdaq" | "NYSE" };

/** Every Nasdaq and NYSE company the SEC knows about, keyed by ticker (BRK.B style). */
export function companies(): Promise<Map<string, Company>> {
  return cached("sec:tickers", 12 * 3600_000, async () => {
    const json = await secJson<{ data: [number, string, string, string][] }>(
      "https://www.sec.gov/files/company_tickers_exchange.json",
      43200,
    );
    const map = new Map<string, Company>();
    for (const [cik, name, ticker, exchange] of json.data) {
      if (exchange !== "Nasdaq" && exchange !== "NYSE") continue;
      const t = ticker.replace("-", ".").toUpperCase();
      if (!map.has(t)) map.set(t, { cik, name, ticker: t, exchange });
    }
    return map;
  });
}

export async function lookup(ticker: string) {
  return (await companies()).get(ticker.toUpperCase()) ?? null;
}

const pad = (cik: number) => String(cik).padStart(10, "0");

type Recent = {
  accessionNumber: string[];
  filingDate: string[];
  acceptanceDateTime: string[];
  form: string[];
  items: string[];
  primaryDocument: string[];
};

export type Submissions = {
  name: string;
  sicDescription: string;
  website: string;
  investorWebsite: string;
  phone: string;
  fiscalYearEnd: string;
  addresses: { business?: { street1: string; street2: string | null; city: string; stateOrCountry: string; zipCode: string } };
  filings: { recent: Recent };
};

export function submissions(cik: number): Promise<Submissions> {
  // Shared for 30 seconds: fast pages, and a brand-new filing still shows within a minute.
  return cached(`sec:sub:${cik}`, 30_000, () => secJson(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`, 30));
}

export type Filing = {
  accession: string; // 0000320193-26-000018
  primaryDocument: string;
  form: string;
  items: string[];
  accepted: string; // ISO instant
  dateOnly: boolean; // true when only the filing date is known
  url: string;
  indexUrl: string;
};

/**
 * Exact acceptance times, keyed by accession number. The submissions JSON has an
 * acceptanceDateTime field, but its time zone differs between filers, so we use
 * the company Atom feed, which carries an explicit offset.
 */
function acceptanceTimes(cik: number): Promise<Map<string, string>> {
  return cached(`sec:atom:${cik}`, 60_000, async () => {
    const res = await fetch(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${pad(cik)}&type=&dateb=&owner=include&count=100&output=atom`,
      { headers: { "User-Agent": UA }, next: { revalidate: 30 } },
    );
    if (!res.ok) return new Map();
    const xml = await res.text();
    const map = new Map<string, string>();
    for (const entry of xml.split("<entry>").slice(1)) {
      const acc = entry.match(/<accession-number>([^<]+)<\/accession-number>/)?.[1];
      const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1];
      if (acc && updated) map.set(acc, new Date(updated).toISOString());
    }
    return map;
  });
}

export async function recentFilings(cik: number): Promise<Filing[]> {
  const [sub, times] = await Promise.all([submissions(cik), acceptanceTimes(cik).catch(() => new Map<string, string>())]);
  const r = sub.filings.recent;
  return r.form.map((form, i) => {
    const acc = r.accessionNumber[i].replace(/-/g, "");
    const exact = times.get(r.accessionNumber[i]);
    return {
      accession: r.accessionNumber[i],
      primaryDocument: r.primaryDocument[i],
      form,
      items: r.items[i] ? r.items[i].split(",") : [],
      accepted: exact ?? new Date(r.filingDate[i] + "T16:00:00Z").toISOString(),
      dateOnly: !exact,
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${r.primaryDocument[i]}`,
      indexUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/`,
    };
  });
}

export type Fact = { start?: string; end: string; val: number; filed: string; form: string; fp?: string };
type Facts = { facts: Record<string, Record<string, { units: Record<string, Fact[]> }>> };

export function companyFacts(cik: number): Promise<Facts> {
  return cached(`sec:facts:${cik}`, 6 * 3600_000, () =>
    secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`),
  );
}

export function factUnits(facts: Facts, taxonomy: string, tag: string, unit: string): Fact[] {
  return facts.facts[taxonomy]?.[tag]?.units[unit] ?? [];
}
