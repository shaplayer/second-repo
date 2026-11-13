/**
 * The SEC's own record of a company: who it is, and what it has filed lately. Pure parsing.
 *
 * The record's acceptance times are not reliable (their time zone differs between filers), so the
 * company's Atom feed, which states the offset, is read as well and its times win.
 */
import { decodeEntities } from "./text";

const pad = (cik: number) => String(cik).padStart(10, "0");

export const submissionsUrl = (cik: number) => `https://data.sec.gov/submissions/CIK${pad(cik)}.json`;
export const companyFactsUrl = (cik: number) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`;
export const companyAtomUrl = (cik: number) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${pad(cik)}&type=&dateb=&owner=include&count=100&output=atom`;

export type CompanyRecord = {
  name: string;
  sic: string | null;
  sicDescription: string | null;
  website: string | null;
  phone: string | null;
  /** Month and day, e.g. "1231". */
  fiscalYearEnd: string | null;
  city: string | null;
  state: string | null;
  /** The SEC's line, e.g. "Non-accelerated filer | Emerging growth company". */
  filerCategory: string | null;
  isEmergingGrowth: boolean;
  tickers: string[];
  exchanges: string[];
};

export type RecentFiling = {
  accession: string;
  form: string;
  filedDate: string;
  /** As the record gives it. Its time zone cannot be trusted: prefer parseCompanyAtom's times. */
  acceptance: string | null;
  items: string[];
  primaryDocument: string | null;
};

const str = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};

/** "CUPERTINO" -> "Cupertino", "ST. LOUIS" -> "St. Louis". Mixed case is left as the SEC has it. */
const tidyPlace = (s: string | null) =>
  s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase()) : s;

function website(v: unknown): string | null {
  const s = str(v);
  if (!s || /\s/.test(s) || !/\.[a-z]{2,}/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? null : `https://${s}`;
}

/** Reads https://data.sec.gov/submissions/CIK##########.json. Throws when it is not that file. */
export function parseSubmissions(json: unknown): {
  company: CompanyRecord;
  recent: RecentFiling[];
  /**
   * True when the company also files insider-trade reports about OTHER companies' shares (as a big
   * shareholder). Its list of filings then mixes those in with reports about its own shares, and the
   * record does not say which is which.
   */
  reportsAsInsider: boolean;
} {
  const j = json as Record<string, unknown> | null;
  const name = str(j?.name);
  if (!j || typeof j !== "object" || !name) throw new Error("Not an SEC company record: it has no name");

  const business = ((j.addresses as Record<string, unknown> | undefined)?.business ?? {}) as Record<string, unknown>;
  const category = str(j.category);
  const parts = (category ?? "").split(/<br\s*\/?>|\|/i).map((p) => p.trim()).filter(Boolean);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null) : []);
  const fye = str(j.fiscalYearEnd);

  const company: CompanyRecord = {
    name,
    sic: str(j.sic),
    sicDescription: str(j.sicDescription),
    website: website(j.website) ?? website(j.investorWebsite),
    phone: str(j.phone),
    fiscalYearEnd: fye && /^\d{4}$/.test(fye) ? fye : null,
    city: tidyPlace(str(business.city)),
    state: str(business.stateOrCountry) ?? str(business.country),
    filerCategory: parts.length ? parts.join(" | ") : null,
    isEmergingGrowth: /emerging growth company/i.test(category ?? ""),
    tickers: list(j.tickers),
    exchanges: list(j.exchanges),
  };

  const r = ((j.filings as Record<string, unknown> | undefined)?.recent ?? {}) as Record<string, unknown>;
  const col = (key: string): unknown[] => (Array.isArray(r[key]) ? (r[key] as unknown[]) : []);
  const [acc, forms, filed, accepted, items, docs] = [
    col("accessionNumber"), col("form"), col("filingDate"), col("acceptanceDateTime"), col("items"), col("primaryDocument"),
  ];
  const recent: RecentFiling[] = [];
  for (let i = 0; i < acc.length; i++) {
    const accession = str(acc[i]);
    const form = str(forms[i]);
    const filedDate = str(filed[i]);
    if (!accession || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !form || !filedDate || !/^\d{4}-\d{2}-\d{2}$/.test(filedDate)) continue;
    recent.push({
      accession,
      form,
      filedDate,
      acceptance: str(accepted[i]),
      items: (str(items[i]) ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{1,2}\.\d{2}$/.test(s)),
      primaryDocument: str(docs[i]),
    });
  }
  const flag = j.insiderTransactionForOwnerExists;
  return { company, recent, reportsAsInsider: flag === 1 || flag === true || flag === "1" };
}

/** Exact acceptance times from the company's Atom feed, by accession number. Unreadable entries are left out. */
export function parseCompanyAtom(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of String(xml ?? "").matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)) {
    const entry = m[1];
    const accession =
      /<accession-number\b[^>]*>\s*(\d{10}-\d{2}-\d{6})\s*</i.exec(entry)?.[1] ?? /accession-number=(\d{10}-\d{2}-\d{6})/.exec(entry)?.[1];
    const updated = new Date(decodeEntities(/<updated\b[^>]*>([^<]+)</i.exec(entry)?.[1] ?? "").trim());
    if (accession && Number.isFinite(updated.getTime())) map.set(accession, updated.toISOString());
  }
  return map;
}

const nyHour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });

/** The moment a clock in New York shows `hour`:00 on a date ("2026-11-04", 16 -> "2026-11-04T21:00:00.000Z"). */
export function newYorkClockToIso(date: string, hour: number): string {
  const [y, m, d] = date.split("-").map(Number);
  for (const offset of [4, 5]) {
    const t = new Date(Date.UTC(y, m - 1, d, hour + offset));
    if (Number(nyHour.format(t)) === hour) return t.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, hour + 5)).toISOString();
}
