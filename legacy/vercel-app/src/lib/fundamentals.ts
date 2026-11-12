import { unstable_cache } from "next/cache";
import { companyFacts, factUnits, type Fact } from "./sec";

type Point = { end: string; val: number };

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

/**
 * Turn reported facts into one value per fiscal quarter. Companies report Q1–Q3
 * directly but only report Q4 inside the annual total, so Q4 = year − first nine months.
 */
export function quarterly(facts: Fact[]): Point[] {
  const q = new Map<string, { val: number; filed: string }>();
  const put = (end: string, val: number, filed: string) => {
    const cur = q.get(end);
    if (!cur || filed > cur.filed) q.set(end, { val, filed });
  };
  const withSpan = facts.filter((f) => f.start);
  for (const f of withSpan) {
    const d = days(f.start!, f.end);
    if (d >= 80 && d <= 100) put(f.end, f.val, f.filed);
  }
  for (const year of withSpan) {
    const d = days(year.start!, year.end);
    if (d < 350 || d > 380 || q.has(year.end)) continue;
    const nine = withSpan
      .filter((n) => n.start === year.start && days(n.start!, n.end) >= 260 && days(n.start!, n.end) <= 285)
      .sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
    if (nine) {
      put(year.end, year.val - nine.val, year.filed);
      continue;
    }
    const inside = [...q.entries()].filter(([end]) => end > year.start! && end < year.end);
    if (inside.length === 3) put(year.end, year.val - inside.reduce((s, [, v]) => s + v.val, 0), year.filed);
  }
  return [...q.entries()].map(([end, v]) => ({ end, val: v.val })).sort((a, b) => (a.end < b.end ? -1 : 1));
}

/** Of several possible tags, use the one with the freshest quarterly data. */
function bestSeries(facts: Awaited<ReturnType<typeof companyFacts>>, tags: string[], unit = "USD") {
  let best: Point[] = [];
  for (const tag of tags) {
    const s = quarterly(factUnits(facts, "us-gaap", tag, unit));
    if (!s.length) continue;
    const newer = !best.length || s[s.length - 1].end > best[best.length - 1].end;
    const sameButLonger = best.length && s[s.length - 1].end === best[best.length - 1].end && s.length > best.length;
    if (newer || sameButLonger) best = s;
  }
  return best;
}

const REVENUE = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "RevenuesNetOfInterestExpense",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
];
const NET_INCOME = ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"];
const DIVIDEND = ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"];

export type Verdict = "Strong" | "Mixed" | "Weak";
export type Check = { name: string; results: (boolean | null)[] };
export type Score = {
  verdict: Verdict;
  passed: number;
  answered: number;
  quarters: string[];
  checks: Check[];
  summary: string;
};
export type Fundamentals = {
  score: Score | null;
  ttmRevenue: number | null;
  ttmProfit: number | null;
  sharesOutstanding: number | null;
  ttmDividendPerShare: number | null;
};

const quarterLabel = (end: string) =>
  new Date(end + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " '");

function yearAgo(series: Point[], end: string) {
  return series.find((p) => Math.abs(days(p.end, end) - 365) <= 20) ?? null;
}

function ttm(series: Point[]) {
  if (series.length < 4) return null;
  const last4 = series.slice(-4);
  if (days(last4[0].end, last4[3].end) > 300) return null;
  return last4.reduce((s, p) => s + p.val, 0);
}

function buildScore(rev: Point[], ni: Point[]): Score | null {
  const recent = ni.slice(-4);
  if (recent.length < 4) return null;
  const revAt = (end: string) => rev.find((p) => p.end === end) ?? null;

  const rows: Check[] = [
    { name: "Sales grew vs. a year ago", results: [] },
    { name: "Made a profit", results: [] },
    { name: "Profit grew vs. a year ago", results: [] },
    { name: "Profit margin held up", results: [] },
  ];
  for (const q of recent) {
    const r = revAt(q.end);
    const rPrev = r ? yearAgo(rev, q.end) : null;
    const nPrev = yearAgo(ni, q.end);
    rows[0].results.push(r && rPrev ? r.val > rPrev.val : null);
    rows[1].results.push(q.val > 0);
    rows[2].results.push(nPrev ? q.val > nPrev.val : null);
    const m = r && r.val ? q.val / r.val : null;
    const mPrev = rPrev && nPrev && rPrev.val ? nPrev.val / rPrev.val : null;
    rows[3].results.push(m !== null && mPrev !== null ? m >= mPrev - 0.01 : null);
  }

  const all = rows.flatMap((r) => r.results).filter((x): x is boolean => x !== null);
  if (all.length < 8) return null;
  const passed = all.filter(Boolean).length;
  const ratio = passed / all.length;
  const verdict: Verdict = ratio >= 0.75 ? "Strong" : ratio >= 0.5 ? "Mixed" : "Weak";

  const count = (r: Check) => {
    const known = r.results.filter((x) => x !== null);
    return `${known.filter(Boolean).length} of ${known.length}`;
  };
  const summary = [
    rows[0].results.some((x) => x !== null) ? `Sales grew in ${count(rows[0])} recent quarters.` : null,
    `Profitable in ${count(rows[1])}.`,
    rows[2].results.some((x) => x !== null) ? `Profit grew in ${count(rows[2])}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return { verdict, passed, answered: all.length, quarters: recent.map((q) => quarterLabel(q.end)), checks: rows, summary };
}

/** Most recent share count. Companies with several share classes report one line per class on the same date. */
function latestShares(facts: Fact[]) {
  const latestEnd = facts.reduce((m, f) => (f.end > m ? f.end : m), "");
  if (!latestEnd) return null;
  const sameDate = facts.filter((f) => f.end === latestEnd);
  const newestFiled = sameDate.reduce((m, f) => (f.filed > m ? f.filed : m), "");
  return sameDate.filter((f) => f.filed === newestFiled && !f.start).reduce((s, f) => s + f.val, 0) || sameDate[0].val;
}

/** Fundamentals change only when a new report is filed, so results are shared for 6 hours. */
export const fundamentals = (cik: number) =>
  unstable_cache(() => computeFundamentals(cik), ["fundamentals-v1", String(cik)], { revalidate: 21600 })();

async function computeFundamentals(cik: number): Promise<Fundamentals> {
  const facts = await companyFacts(cik).catch(() => null);
  if (!facts) return { score: null, ttmRevenue: null, ttmProfit: null, sharesOutstanding: null, ttmDividendPerShare: null };

  const rev = bestSeries(facts, REVENUE);
  const ni = bestSeries(facts, NET_INCOME);
  const div = bestSeries(facts, DIVIDEND, "USD/shares");

  const sharesOutstanding =
    latestShares(factUnits(facts, "dei", "EntityCommonStockSharesOutstanding", "shares")) ??
    latestShares(factUnits(facts, "us-gaap", "CommonStockSharesOutstanding", "shares")) ??
    latestShares(factUnits(facts, "us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding", "shares"));

  const lastDiv = div[div.length - 1];
  const freshDiv = lastDiv && days(lastDiv.end, new Date().toISOString().slice(0, 10)) < 200;

  return {
    score: buildScore(rev, ni),
    ttmRevenue: ttm(rev),
    ttmProfit: ttm(ni),
    sharesOutstanding,
    ttmDividendPerShare: freshDiv ? ttm(div) : null,
  };
}
