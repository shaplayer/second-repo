/**
 * Reading the SEC "companyfacts" file: one figure per period, one figure per quarter, last-twelve-months
 * totals and balance-sheet values. Pure functions: nothing here fetches or stores anything.
 *
 * The file looks like facts[taxonomy][tag].units[unit] = [{ start?, end, val, accn, form, filed }, ...].
 * A fact with `start` covers a period; one without is a balance on the `end` date. The same period usually
 * appears several times, once for every filing that mentions it.
 */

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Fact = { start: string | null; end: string; val: number; filed: string; form: string; accn: string };

/** One quarter's figure. `derived` = worked out by subtraction rather than reported for the quarter itself. */
export type Point = { end: string; value: number; filed: string; derived: boolean };

/** One figure per quarter, oldest first. */
export type Series = { points: Point[]; at: Map<string, Point> };

/** A figure together with the newest filing date among the facts it came from. */
export type Sourced = { value: number; filed: string };

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
}

/** Calendar days from a to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

const later = (a: string, b: string) => (a > b ? a : b);
const between = (n: number, lo: number, hi: number) => n >= lo && n <= hi;
const isQuarterLong = (n: number) => between(n, 80, 100);
const isYearLong = (n: number) => between(n, 350, 380);

/** The item with the smallest score; the first one on a tie. */
function closest<T>(items: readonly T[], score: (item: T) => number): T {
  let best = items[0];
  for (const item of items) if (score(item) < score(best)) best = item;
  return best;
}

/* ------------------------------------------------------------------ reading */

export type FactSource = {
  /** Facts of one tag in file order; anything malformed is skipped. */
  get(tag: string, unit?: string, taxonomy?: string): readonly Fact[];
  /** The quarterly series of a tag (worked out once). */
  series(tag: string, unit?: string): Series;
  /** Earliest `filed` date among all facts, of any tag, that came from one of these forms. */
  firstFiled(forms: ReadonlySet<string>): string | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseFact(v: unknown): Fact | null {
  if (!isRecord(v)) return null;
  const { start, end, val, filed, form, accn } = v;
  if (!isIsoDate(end) || !isIsoDate(filed) || typeof val !== "number" || !Number.isFinite(val)) return null;
  if (start !== undefined && start !== null && !isIsoDate(start)) return null;
  if (isIsoDate(start) && start > end) return null;
  return { start: isIsoDate(start) ? start : null, end, val, filed, form: typeof form === "string" ? form : "", accn: typeof accn === "string" ? accn : "" };
}

/** Wraps whatever was downloaded. Never throws: a missing or odd file simply has no facts. */
export function openFacts(raw: unknown): FactSource {
  const taxonomies = isRecord(raw) && isRecord(raw.facts) ? raw.facts : {};
  const factCache = new Map<string, readonly Fact[]>();
  const seriesCache = new Map<string, Series>();

  const get = (tag: string, unit = "USD", taxonomy = "us-gaap"): readonly Fact[] => {
    const key = `${taxonomy}|${tag}|${unit}`;
    let facts = factCache.get(key);
    if (!facts) {
      const tags = taxonomies[taxonomy];
      const body = isRecord(tags) ? tags[tag] : undefined;
      const units = isRecord(body) && isRecord(body.units) ? body.units[unit] : undefined;
      facts = Array.isArray(units) ? units.map(parseFact).filter((f): f is Fact => f !== null) : [];
      factCache.set(key, facts);
    }
    return facts;
  };

  const series = (tag: string, unit = "USD"): Series => {
    const key = `${tag}|${unit}`;
    let s = seriesCache.get(key);
    if (!s) {
      s = quarterlySeries(get(tag, unit));
      seriesCache.set(key, s);
    }
    return s;
  };

  const firstFiled = (forms: ReadonlySet<string>): string | null => {
    let first: string | null = null;
    for (const tags of Object.values(taxonomies)) {
      if (!isRecord(tags)) continue;
      for (const body of Object.values(tags)) {
        if (!isRecord(body) || !isRecord(body.units)) continue;
        for (const list of Object.values(body.units)) {
          if (!Array.isArray(list)) continue;
          for (const x of list) {
            if (!isRecord(x) || typeof x.form !== "string" || !forms.has(x.form) || !isIsoDate(x.filed)) continue;
            if (first === null || x.filed < first) first = x.filed;
          }
        }
      }
    }
    return first;
  };

  return { get, series, firstFiled };
}

/* ------------------------------------------------------------ de-duplication */

/** Annual and quarterly reports (and their amended versions), as opposed to registration or merger filings. */
const PERIODIC_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F", "10-KT", "10-QT"]);

export function isPeriodicForm(form: string): boolean {
  return PERIODIC_FORMS.has(form.endsWith("/A") ? form.slice(0, -2) : form);
}

/**
 * When the same period appears in several filings: a figure from an annual or quarterly report beats one
 * from a registration or merger filing, then the latest filing wins (so a restated figure replaces the
 * original). On a complete tie the one listed first stays.
 */
function supersedes(candidate: Fact, current: Fact): boolean {
  const periodic = isPeriodicForm(candidate.form);
  if (periodic !== isPeriodicForm(current.form)) return periodic;
  return candidate.filed > current.filed;
}

function dedupe(facts: readonly Fact[], key: (f: Fact) => string): Fact[] {
  const best = new Map<string, Fact>();
  for (const f of facts) {
    const k = key(f);
    const current = best.get(k);
    if (!current || supersedes(f, current)) best.set(k, f);
  }
  return [...best.values()];
}

/** One fact per period (start and end). Facts without a start are ignored. */
export function dedupeDurations(facts: readonly Fact[]): Fact[] {
  return dedupe(facts.filter((f) => f.start !== null), (f) => `${f.start}|${f.end}`);
}

/** One fact per balance date. Facts with a start are ignored. */
export function dedupeInstants(facts: readonly Fact[]): Fact[] {
  return dedupe(facts.filter((f) => f.start === null), (f) => f.end).sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
}

const length = (f: Fact) => daysBetween(f.start as string, f.end);

/* ---------------------------------------------------------- quarterly series */

/** How far the quarters of a year may be from its reported total: 1%, or 1,000 if that is larger. */
export function yearTolerance(yearTotal: number): number {
  return Math.max(1000, 0.01 * Math.abs(yearTotal));
}

/** A quarter while the series is being built: how long the fact was, and the full-year fact it was cut from. */
type Working = Point & { days: number; year: Fact | null };

/**
 * Checks each fourth quarter against its year. The three quarters before it plus the fourth must add up to the
 * reported full-year figure (within yearTolerance). If they do not:
 *  - a fourth quarter that came from a subtraction is left out, because one of the pieces is wrong and the
 *    figures cannot say which;
 *  - a stand-alone fourth-quarter fact is replaced only when the year minus its first nine months and the year
 *    minus its three quarters agree with each other (then the stand-alone fact is the odd one out).
 */
function checkFourthQuarters(table: readonly Fact[], q: Map<string, Working>): void {
  const drop: string[] = [];
  const replace: Working[] = [];
  for (const p of q.values()) {
    const years = p.year ? [p.year] : p.derived ? [] : table.filter((f) => f.end === p.end && isYearLong(length(f)));
    if (!years.length) continue;
    const year = closest(years, (f) => Math.abs(length(f) - 365));
    const inside = [...q.values()].filter((x) => x.end > (year.start as string) && x.end < year.end);
    if (inside.length !== 3) continue; // nothing to check the quarter against
    const remainder = year.val - inside.reduce((s, x) => s + x.value, 0);
    const tolerance = yearTolerance(year.val);
    if (Math.abs(p.value - remainder) <= tolerance) continue;
    if (p.derived) {
      drop.push(p.end);
      continue;
    }
    // A stand-alone fourth-quarter fact that disagrees with the year. If the year minus its first nine
    // months gives the same answer as the year minus its three quarters, those two win.
    const nineMonths = table.filter((g) => g.start === year.start && between(daysBetween(g.end, year.end), 75, 100));
    if (!nineMonths.length) continue;
    const g = closest(nineMonths, (x) => Math.abs(daysBetween(x.end, year.end) - 91));
    if (Math.abs(year.val - g.val - remainder) <= tolerance) {
      replace.push({ ...p, value: year.val - g.val, filed: later(year.filed, g.filed), derived: true });
    }
  }
  for (const end of drop) q.delete(end);
  for (const p of replace) q.set(p.end, p);
}

/**
 * One value per quarter end:
 *  1. a fact that covers 80 to 100 days is the quarter itself;
 *  2. otherwise the difference of two year-to-date facts that start on the same day and end a quarter apart
 *     (six months minus three, nine minus six, the full year minus nine months);
 *  3. otherwise the full year minus the three quarters inside it.
 * A fourth quarter that came from a subtraction is then checked against the year: if the four quarters do not
 * add up to the reported full-year figure, that quarter is left out rather than guessed.
 */
export function quarterlySeries(facts: readonly Fact[]): Series {
  const table = dedupeDurations(facts);
  const q = new Map<string, Working>();

  for (const f of table) {
    const n = length(f);
    if (!isQuarterLong(n)) continue;
    const current = q.get(f.end);
    // Two facts for one quarter end (a period counted from the day a company was formed, say): the one
    // closest to 91 days is the quarter.
    if (current && Math.abs(current.days - 91) <= Math.abs(n - 91)) continue;
    q.set(f.end, { end: f.end, value: f.val, filed: f.filed, derived: false, days: n, year: null });
  }

  const shortestFirst = [...table].sort((a, b) => length(a) - length(b));
  for (const f of shortestFirst) {
    const n = length(f);
    if (n <= 100 || n > 380 || q.has(f.end)) continue;
    // The earlier year-to-date fact starts on the same day and ends a quarter before, so it is always shorter.
    const earlier = table.filter((g) => g.start === f.start && between(daysBetween(g.end, f.end), 75, 100));
    if (earlier.length) {
      const g = closest(earlier, (x) => Math.abs(daysBetween(x.end, f.end) - 91));
      q.set(f.end, { end: f.end, value: f.val - g.val, filed: later(f.filed, g.filed), derived: true, days: n, year: isYearLong(n) ? f : null });
      continue;
    }
    if (isYearLong(n)) {
      const inside = [...q.values()].filter((p) => p.end > (f.start as string) && p.end < f.end);
      if (inside.length === 3) {
        const filed = inside.reduce((m, p) => later(m, p.filed), f.filed);
        q.set(f.end, { end: f.end, value: f.val - inside.reduce((s, p) => s + p.value, 0), filed, derived: true, days: n, year: null });
      }
    }
  }

  checkFourthQuarters(table, q);

  const points = [...q.values()]
    .map(({ end, value, filed, derived }) => ({ end, value, filed, derived }))
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  return { points, at: new Map(points.map((p) => [p.end, p])) };
}

/** Of several tags for the same measure, the one with the newest quarter; on a tie the one with more recent quarters, then the one listed first. */
export function bestSeries(source: FactSource, tags: readonly string[], unit = "USD"): { tag: string | null; series: Series } {
  // Only the quarters the checks can use are counted (the newest four and the same four a year earlier), so a
  // gap in old history does not change which tag is read.
  const recent = (s: Series): number => {
    const newest = s.points.length ? s.points[s.points.length - 1].end : "";
    return s.points.filter((p) => daysBetween(p.end, newest) <= 660).length;
  };
  let tag: string | null = null;
  let best: Series = { points: [], at: new Map() };
  for (const t of tags) {
    const s = source.series(t, unit);
    if (!s.points.length) continue;
    const newest = s.points[s.points.length - 1].end;
    const bestNewest = best.points.length ? best.points[best.points.length - 1].end : "";
    if (tag === null || newest > bestNewest || (newest === bestNewest && recent(s) > recent(best))) {
      tag = t;
      best = s;
    }
  }
  return { tag, series: best };
}

/** The same quarter a year earlier: the quarter that ended 365 days before, give or take 20. */
export function yearAgo(series: Series, end: string): Point | null {
  const found = series.points.filter((p) => Math.abs(daysBetween(p.end, end) - 365) <= 20);
  if (!found.length) return null;
  return closest(found, (p) => Math.abs(daysBetween(p.end, end) - 365));
}

/** True when each quarter end follows the one before by 80 to 100 days. */
export function areConsecutive(ends: readonly string[]): boolean {
  return ends.every((end, i) => i === 0 || between(daysBetween(ends[i - 1], end), 80, 100));
}

/* ------------------------------------------------------- last twelve months */

/**
 * The total for the twelve months up to `end`:
 *  1. a full-year fact that ends there; or
 *  2. the last full year, plus this year so far, minus the same stretch of last year; or
 *  3. the four quarters up to `end` added together.
 */
export function trailingTwelveMonths(facts: readonly Fact[], end: string, series: Series = quarterlySeries(facts)): Sourced | null {
  const table = dedupeDurations(facts);

  const years = table.filter((f) => f.end === end && isYearLong(length(f)));
  if (years.length) {
    const year = closest(years, (f) => Math.abs(length(f) - 365));
    return { value: year.val, filed: year.filed };
  }

  const soFar = table.filter((f) => f.end === end && length(f) < 300).sort((a, b) => length(b) - length(a));
  for (const current of soFar) {
    const n = length(current);
    const lastYears = table.filter((f) => isYearLong(length(f)) && Math.abs(daysBetween(f.end, current.start as string)) <= 20);
    const priors = table.filter((f) => Math.abs(daysBetween(f.end, end) - 365) <= 20 && Math.abs(length(f) - n) <= 12);
    if (!lastYears.length || !priors.length) continue;
    const lastYear = closest(lastYears, (f) => Math.abs(daysBetween(f.end, current.start as string) - 1));
    const prior = closest(priors, (f) => Math.abs(daysBetween(f.end, end) - 365) * 100 + Math.abs(length(f) - n));
    return { value: lastYear.val + current.val - prior.val, filed: later(later(lastYear.filed, current.filed), prior.filed) };
  }

  const upTo = series.points.filter((p) => p.end <= end);
  const four = upTo.slice(-4);
  if (four.length === 4 && four[3].end === end && daysBetween(four[0].end, end) <= 300) {
    return { value: four.reduce((s, p) => s + p.value, 0), filed: four.reduce((m, p) => later(m, p.filed), "") };
  }
  return null;
}

/* ------------------------------------------------------------ balance sheet */

/** The balance on `end`, or failing that the one nearest to it within `toleranceDays`. */
export function instantAt(facts: readonly Fact[], end: string, toleranceDays = 6): (Sourced & { end: string }) | null {
  const table = dedupeInstants(facts);
  const exact = table.find((f) => f.end === end);
  const near = table.filter((f) => Math.abs(daysBetween(f.end, end)) <= toleranceDays);
  const hit = exact ?? (near.length ? closest(near, (f) => Math.abs(daysBetween(f.end, end))) : null);
  return hit ? { value: hit.val, filed: hit.filed, end: hit.end } : null;
}

/** The largest of several tags' balances on a date (they are alternative names for the same line). */
export function largestAt(source: FactSource, tags: readonly string[], end: string, toleranceDays = 6): Sourced | null {
  let best: Sourced | null = null;
  for (const tag of tags) {
    const v = instantAt(source.get(tag), end, toleranceDays);
    if (v && (best === null || v.value > best.value)) best = { value: v.value, filed: v.filed };
  }
  return best;
}

const UNRESTRICTED_CASH_TAGS = ["CashAndCashEquivalentsAtCarryingValue", "Cash"];
const CASH_WITH_RESTRICTED_TAGS = [
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations",
];
const CURRENT_INVESTMENT_TAGS = [
  "ShortTermInvestments",
  "MarketableSecuritiesCurrent",
  "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
  "DebtSecuritiesAvailableForSaleExcludingAccruedInterestCurrent",
  "HeldToMaturitySecuritiesCurrent",
  "DebtSecuritiesHeldToMaturityExcludingAccruedInterestAfterAllowanceForCreditLossCurrent",
  "EquitySecuritiesFvNi",
  "OtherShortTermInvestments",
  "CertificatesOfDepositAtCarryingValue",
];
const NONCURRENT_INVESTMENT_TAGS = [
  "MarketableSecuritiesNoncurrent",
  "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent",
  "DebtSecuritiesAvailableForSaleExcludingAccruedInterestNoncurrent",
  "HeldToMaturitySecuritiesNoncurrent",
];
/** Totals from the notes to the accounts. They can include cash equivalents, so they are a last resort and a ceiling. */
const FOOTNOTE_INVESTMENT_TAGS = [
  "AvailableForSaleSecuritiesDebtSecurities",
  "DebtSecuritiesAvailableForSaleExcludingAccruedInterest",
  "MarketableSecurities",
  "DebtSecuritiesAvailableForSaleAndHeldToMaturity",
];
const CASH_AND_SHORT_TERM_TAG = "CashCashEquivalentsAndShortTermInvestments";

/**
 * Cash and investments a company could spend, on a quarter-end date, built from balance-sheet lines so that
 * nothing is counted twice:
 *   cash it is free to use + investments due within a year + longer-term investments.
 * - Cash that is set aside (restricted) only counts when the company reports no other cash figure.
 * - A footnote total of securities is used only when there is no investment line on the balance sheet, and the
 *   lines together may not exceed it (it already contains them).
 * - The result may not exceed current assets plus long-term investments.
 * Returns null when no cash figure is reported for the date.
 */
export function liquidFunds(source: FactSource, end: string): Sourced | null {
  const cash =
    instantAt(source.get(UNRESTRICTED_CASH_TAGS[0]), end) ??
    instantAt(source.get(UNRESTRICTED_CASH_TAGS[1]), end) ??
    largestAt(source, CASH_WITH_RESTRICTED_TAGS, end);
  if (!cash) return null;
  let filed = cash.filed;
  const use = (v: Sourced | null): number | null => {
    if (!v) return null;
    filed = later(filed, v.filed);
    return v.value;
  };

  const current = use(largestAt(source, CURRENT_INVESTMENT_TAGS, end));
  const noncurrent = use(largestAt(source, NONCURRENT_INVESTMENT_TAGS, end));
  const footnote = largestAt(source, FOOTNOTE_INVESTMENT_TAGS, end);

  let nearTerm = cash.value; // cash plus investments due within a year
  let longTerm = 0;
  if (current === null && noncurrent === null) {
    nearTerm += use(footnote) ?? 0;
  } else {
    let lines = (current ?? 0) + (noncurrent ?? 0);
    // A footnote total that is at least as large as each line contains them both: their sum cannot exceed it.
    if (footnote && footnote.value >= Math.max(current ?? 0, noncurrent ?? 0) && lines > footnote.value) lines = use(footnote) as number;
    const currentPart = Math.min(current ?? 0, lines);
    nearTerm += currentPart;
    longTerm = lines - currentPart;
  }
  // Some companies report cash and short-term investments as one figure. The total cannot be less than that.
  let total = nearTerm + longTerm;
  const combined = instantAt(source.get(CASH_AND_SHORT_TERM_TAG), end);
  if (combined && combined.value > total) total = use(combined) as number;

  const currentAssets = instantAt(source.get("AssetsCurrent"), end);
  if (currentAssets) {
    const longTermInvestments = largestAt(source, [...NONCURRENT_INVESTMENT_TAGS, "LongTermInvestments"], end)?.value ?? 0;
    const ceiling = currentAssets.value + longTermInvestments;
    if (total > ceiling) {
      total = ceiling;
      filed = later(filed, currentAssets.filed);
    }
  }
  return { value: total, filed };
}
