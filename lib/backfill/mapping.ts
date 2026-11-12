/**
 * Pure rules for copying the two old databases into the unified tables (plan Phase 1, step 3).
 * No database access here, so every rule can be tested on its own.
 */
import { createHash } from "node:crypto";

/* ---------- SEC links ---------- */

export type SecLink = { cik: number; accession: string };

/** Reads the company number and accession number out of a link into the SEC's archive. */
export function parseSecArchiveUrl(url: string | null | undefined): SecLink | null {
  const m = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/(\d{1,10})\/(\d{18})(?:\/|$)/.exec(url ?? "");
  if (!m) return null;
  const a = m[2];
  const cik = Number(m[1]);
  if (!(cik > 0)) return null;
  return { cik, accession: `${a.slice(0, 10)}-${a.slice(10, 12)}-${a.slice(12)}` };
}

export const secIndexUrl = (cik: number, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${accession}-index.htm`;

/* ---------- News sources ---------- */

const SOURCE_KEYS: Record<string, string> = {
  "pr newswire": "prnewswire",
  "business wire": "businesswire",
  globenewswire: "globenewswire",
  "access newswire": "accessnewswire",
  benzinga: "benzinga",
  "stock titan": "stocktitan",
};

/** "PR Newswire" -> "prnewswire". Unknown names (for example the old "Sample Wire" test feed) give null. */
export const newsSourceKey = (name: string | null | undefined) => SOURCE_KEYS[(name ?? "").trim().toLowerCase()] ?? null;

/* ---------- Tokens ---------- */

/**
 * A link token worked out from an old token, so that running the copy again gives the same value.
 * Used where one old token (one per person) has to become several (one per subscription).
 */
export function derivedToken(...parts: (string | number)[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("base64url").slice(0, 32);
}

/* ---------- Alert subscriptions ---------- */

export const CATEGORY_ORDER = ["picks", "press", "earnings", "news", "insider", "ipo", "proxy"] as const;
export type Category = (typeof CATEGORY_ORDER)[number];

export const sortCategories = (cats: Iterable<string>): Category[] => {
  const set = new Set(cats);
  return CATEGORY_ORDER.filter((c) => set.has(c));
};

/** The old app's switches. "news" there meant every company announcement, which now includes press releases. */
export function categoriesFromAppPrefs(prefs: { earnings?: boolean; news?: boolean; insider?: boolean } | null | undefined): Category[] {
  const out: string[] = [];
  if (prefs?.earnings) out.push("earnings");
  if (prefs?.news) out.push("news", "press");
  if (prefs?.insider) out.push("insider");
  return sortCategories(out);
}

/** Following a company on the data site meant its press releases, its filings and BigStocks alerts about it. */
export const DATA_SITE_FOLLOW_CATEGORIES: Category[] = ["picks", "press", "earnings", "news"];

export type Candidate = {
  channel: "email" | "sms";
  address: string;
  cik: number | null;
  categories: Category[];
  cadence: "instant" | "digest";
  status: "pending" | "active" | "unsubscribed";
  confirmToken: string | null;
  unsubscribeToken: string;
  legacyToken: string | null;
  consentText: string | null;
  /** Timestamps are text exactly as the old database holds them (microseconds kept). */
  consentAt: string | null;
  consentIp: string | null;
  consentUserAgent: string | null;
  source: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
  legacy: Record<string, unknown>;
};

export const candidateKey = (c: Pick<Candidate, "channel" | "address" | "cik">) => `${c.channel}|${c.address}|${c.cik ?? ""}`;

const time = (s: string | null) => (s ? Date.parse(s) : NaN);

/**
 * Two old records for the same address, channel and company (one from each old site) become one.
 *
 * - An opt-out wins, unless the other record is a sign-up made after that opt-out. An opt-out with no
 *   recorded time always wins: we never start emailing someone on a guess.
 * - Otherwise a confirmed sign-up beats an unconfirmed one, and the older record is kept.
 * - When neither is an opt-out, the person keeps every kind of alert either record asked for.
 * The record that loses is kept inside `legacy`, with its link tokens, so nothing is thrown away.
 */
export function mergeCandidates(a: Candidate, b: Candidate): Candidate {
  if (candidateKey(a) !== candidateKey(b)) throw new Error("mergeCandidates needs two records for the same subscription");
  const pick = (winner: Candidate, loser: Candidate, both: boolean): Candidate => ({
    ...winner,
    categories: both ? sortCategories([...winner.categories, ...loser.categories]) : winner.categories,
    legacy: { ...winner.legacy, merged_with: loser.legacy, other_tokens: [loser.unsubscribeToken, loser.legacyToken].filter(Boolean) },
  });

  const aOut = a.status === "unsubscribed";
  const bOut = b.status === "unsubscribed";
  if (aOut && bOut) {
    // Keep the opt-out we know more about; with two known times, the later one.
    const [ta, tb] = [time(a.unsubscribedAt), time(b.unsubscribedAt)];
    if (Number.isNaN(tb)) return pick(a, b, false);
    if (Number.isNaN(ta)) return pick(b, a, false);
    return ta >= tb ? pick(a, b, false) : pick(b, a, false);
  }
  if (aOut || bOut) {
    const [out, other] = aOut ? [a, b] : [b, a];
    const optedOutAt = time(out.unsubscribedAt);
    const signedUpAt = time(other.createdAt);
    const signedUpLater = !Number.isNaN(optedOutAt) && !Number.isNaN(signedUpAt) && signedUpAt > optedOutAt;
    return signedUpLater ? pick(other, out, false) : pick(out, other, false);
  }
  if (a.status !== b.status) return a.status === "active" ? pick(a, b, true) : pick(b, a, true);
  return time(a.createdAt) <= time(b.createdAt) ? pick(a, b, true) : pick(b, a, true);
}

/* ---------- Old filing summaries ---------- */

/** The sentence the old app saved when Claude could not be reached: such rows were not written by AI. */
export const BASIC_SUMMARY_WHY = "Open the original filing for the details.";

/** 'rule' = built without AI (insider trades from the filing's own data, or the plain fallback). */
export const summaryKind = (form: string, whyItMatters: string): "ai" | "rule" =>
  form === "4" || whyItMatters === BASIC_SUMMARY_WHY ? "rule" : "ai";
