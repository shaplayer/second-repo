/**
 * The health check: Strong / Mixed / Weak from SEC financial data only. Not investment advice.
 *
 * Two rule sets. "standard" is what every company gets today. "growth" is the proposed set for emerging
 * growth companies that lose money from their operations (plan decision 9, section 6.1); it runs only when
 * the caller passes growthRules: true, which stays false until the site owner approves it.
 *
 * Each check is answered for each of the last four quarters. The verdict is the share of answers that pass:
 * 75% or more Strong, 50% or more Mixed, under 50% Weak, and no score with fewer than 8 answers.
 */
import {
  areConsecutive,
  bestSeries,
  daysBetween,
  instantAt,
  isIsoDate,
  isPeriodicForm,
  largestAt,
  liquidFunds,
  openFacts,
  trailingTwelveMonths,
  yearAgo,
  type Fact,
  type FactSource,
  type Point,
  type Series,
  type Sourced,
} from "./facts";
import { CHECK_TEXT, NO_SCORE, NOTE_NO_SALES, RULE_SET_CHECKS } from "./labels";
import type { CheckKey, CompanyProfile, Fundamentals, HealthCheck, RuleSet, ScoreOptions, Verdict } from "./types";

export const REVENUE_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "RevenuesNetOfInterestExpense",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "RevenueFromCollaborativeArrangementExcludingRevenueFromContractWithCustomer",
];
export const NET_INCOME_TAGS = ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"];
export const OPERATING_INCOME_TAGS = ["OperatingIncomeLoss"];
export const OPERATING_CASH_FLOW_TAGS = [
  "NetCashProvidedByUsedInOperatingActivities",
  "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
];
export const SHARE_TAGS = [
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
];
const TRUST_TAGS = ["AssetsHeldInTrustNoncurrent", "AssetsHeldInTrust", "AssetsHeldInTrustCurrent"];
const BLANK_CHECK_SIC = "6770";
const FUND_SICS = new Set(["6221", "6189", "6722", "6726"]);
/** A company's first annual or quarterly report, whichever form it files them on. */
const FIRST_REPORT_FORMS = new Set(["10-Q", "10-K", "20-F", "40-F", "6-K", "10-Q/A", "10-K/A", "20-F/A", "40-F/A", "6-K/A"]);

const STALE_AFTER_DAYS = 230;
const MIN_ANSWERS = 8;
const MAX_SHARE_GROWTH = 0.2;
const QUARTERS_SHOWN = 8;

type Answer = boolean | null;
type Rows = Partial<Record<CheckKey, Answer[]>>;

/* ------------------------------------------------------------------ verdict */

/** The verdict for a list of answers (null = no answer). Fewer than 8 answers: no score. */
export function verdictOf(answers: readonly Answer[]): { verdict: Verdict | null; passed: number; answered: number } {
  const known = answers.filter((a): a is boolean => a !== null);
  const passed = known.filter(Boolean).length;
  if (known.length < MIN_ANSWERS) return { verdict: null, passed, answered: known.length };
  const ratio = passed / known.length;
  return { verdict: ratio >= 0.75 ? "Strong" : ratio >= 0.5 ? "Mixed" : "Weak", passed, answered: known.length };
}

/* ------------------------------------------------------ who gets which rules */

/** Funds: by industry code, or because the company reported a net asset value per share in the last two years. */
export function isFund(source: FactSource, profile: CompanyProfile, today: string): boolean {
  const sic = profile.sic === null || profile.sic === undefined ? "" : String(profile.sic);
  if (FUND_SICS.has(sic)) return true;
  return source.get("NetAssetValuePerShare", "USD/shares").some((f) => {
    const age = daysBetween(f.end, today);
    return age >= 0 && age <= 730;
  });
}

/**
 * Blank-check companies (SPACs): money held in trust is more than half of everything the company owns, or the
 * industry code says blank check and there have been no sales in the last four quarters. The code alone is not
 * enough: it often stays on a company after it has merged with a real business.
 */
export function isBlankCheck(source: FactSource, profile: CompanyProfile, newestQuarter: string | null, hadSales: boolean): boolean {
  const codedBlankCheck = String(profile.sic ?? "") === BLANK_CHECK_SIC;
  if (codedBlankCheck && !hadSales) return true;
  if (newestQuarter === null) return false;
  const trust = largestAt(source, TRUST_TAGS, newestQuarter, 40);
  const assets = instantAt(source.get("Assets"), newestQuarter, 40);
  return trust !== null && assets !== null && assets.value > 0 && trust.value > 0.5 * assets.value;
}

/**
 * Did the company lose money from its operations over the last four quarters? Uses the twelve-month operating
 * result (net result when there is none); when no twelve-month figure can be built, the sum of the quarters that
 * are known, if there are at least two. null = unknown, which is never read as "profitable" or as a loss.
 */
export function lostMoneyFromOperations(input: {
  ttmOperatingIncome: number | null;
  ttmNetIncome: number | null;
  operatingIncomeQuarters: readonly (number | null)[];
  netIncomeQuarters: readonly (number | null)[];
}): boolean | null {
  const sumOfKnown = (quarters: readonly (number | null)[]): number | null => {
    const known = quarters.filter((v): v is number => v !== null);
    return known.length >= 2 ? known.reduce((s, v) => s + v, 0) : null;
  };
  let result = input.ttmOperatingIncome ?? input.ttmNetIncome;
  if (result === null) result = sumOfKnown(input.operatingIncomeQuarters) ?? sumOfKnown(input.netIncomeQuarters);
  return result === null ? null : result < 0;
}

/* ------------------------------------------------------- last twelve months */

/**
 * The twelve-month total of a measure from one tag: the tag chosen for the quarterly figures whenever it can
 * produce one, another tag of the list only when it cannot.
 */
export function ttmOf(source: FactSource, tags: readonly string[], end: string, chosen: string | null): Sourced | null {
  const order = chosen ? [chosen, ...tags.filter((t) => t !== chosen)] : [...tags];
  for (const tag of order) {
    const facts = source.get(tag);
    if (!facts.length) continue;
    const total = trailingTwelveMonths(facts, end, source.series(tag));
    if (total) return total;
  }
  return null;
}

/* ---------------------------------------------------------------- share count */

const spanOf = (f: Fact) => daysBetween(f.start as string, f.end);

/** As first reported: from an annual or quarterly report when there is one, then the earliest filing. */
function firstReported(facts: readonly Fact[]): Fact | null {
  if (!facts.length) return null;
  return [...facts].sort((a, b) => {
    const periodic = isPeriodicForm(a.form);
    if (periodic !== isPeriodicForm(b.form)) return periodic ? -1 : 1;
    return a.filed < b.filed ? -1 : a.filed > b.filed ? 1 : 0;
  })[0];
}

/** The same period a year earlier, taken from the same filing so that a share split cannot distort the comparison. */
function yearAgoInSameFiling(rows: readonly Fact[], current: Fact): Fact | null {
  const n = spanOf(current);
  const found = rows.filter(
    (f) => f.accn === current.accn && Math.abs(daysBetween(f.end, current.end) - 365) <= 20 && Math.abs(spanOf(f) - n) <= 12,
  );
  return found.length ? found[0] : null;
}

/**
 * The average share count of a fiscal fourth quarter, which companies do not report: four times the year's
 * average minus the three quarterly averages, this year and last year alike. null when a piece is missing or
 * the result is not a positive number (a share split between the reports makes that happen).
 */
function fourthQuarterGrowth(rows: readonly Fact[], year: Fact, yearBefore: Fact): Sourced | null {
  const quarters = rows.filter((f) => spanOf(f) >= 80 && spanOf(f) <= 100 && f.end > (year.start as string) && f.end < year.end);
  const ends = [...new Set(quarters.map((f) => f.end))];
  if (ends.length !== 3) return null;
  let current = 4 * year.val;
  let previous = 4 * yearBefore.val;
  let filed = year.filed;
  for (const end of ends) {
    const quarter = firstReported(quarters.filter((f) => f.end === end));
    const before = quarter ? yearAgoInSameFiling(rows, quarter) : null;
    if (!quarter || !before) return null;
    current -= quarter.val;
    previous -= before.val;
    if (quarter.filed > filed) filed = quarter.filed;
  }
  if (!(current > 0) || !(previous > 0)) return null;
  return { value: current / previous - 1, filed };
}

/**
 * How much the average share count grew on the same quarter a year ago (0.25 = 25% more shares). null = no
 * answer: no figures, or the company had not yet been filing annual or quarterly reports for the whole of
 * the year-ago period.
 */
export function shareGrowth(source: FactSource, end: string, firstReport: string | null): Sourced | null {
  for (const tag of SHARE_TAGS) {
    const rows = source.get(tag, "shares").filter((f) => f.start !== null);
    const endingHere = rows.filter((f) => f.end === end);
    const quarter = firstReported(endingHere.filter((f) => spanOf(f) >= 80 && spanOf(f) <= 100));
    const current = quarter ?? firstReported(endingHere.filter((f) => spanOf(f) >= 350 && spanOf(f) <= 380));
    if (!current) continue;
    const previous = yearAgoInSameFiling(rows, current);
    if (!previous || previous.val === 0) continue;
    if (firstReport === null || firstReport > (previous.start as string)) return null;
    if (!quarter) {
      const derived = fourthQuarterGrowth(rows, current, previous);
      if (derived) return derived;
    }
    return { value: current.val / previous.val - 1, filed: current.filed };
  }
  return null;
}

export function firstReportFiled(source: FactSource): string | null {
  return source.firstFiled(FIRST_REPORT_FORMS);
}

/* -------------------------------------------------------------------- grids */

export type Measures = {
  revenue: { tag: string | null; series: Series };
  netIncome: { tag: string | null; series: Series };
  operatingIncome: { tag: string | null; series: Series };
};

export function readMeasures(source: FactSource): Measures {
  return {
    revenue: bestSeries(source, REVENUE_TAGS),
    netIncome: bestSeries(source, NET_INCOME_TAGS),
    operatingIncome: bestSeries(source, OPERATING_INCOME_TAGS),
  };
}

/** The standard rule set: four checks on sales and profit. */
export function standardRows(m: Measures, four: readonly Point[], used: (filed: string) => void): Rows {
  const rows = { salesGrew: [] as Answer[], madeProfit: [] as Answer[], profitGrew: [] as Answer[], marginHeld: [] as Answer[] };
  for (const quarter of four) {
    const sales = m.revenue.series.at.get(quarter.end) ?? null;
    const salesBefore = sales ? yearAgo(m.revenue.series, quarter.end) : null;
    const profitBefore = yearAgo(m.netIncome.series, quarter.end);
    for (const p of [quarter, sales, salesBefore, profitBefore]) if (p) used(p.filed);

    rows.salesGrew.push(sales && salesBefore ? sales.value > salesBefore.value : null);
    rows.madeProfit.push(quarter.value > 0);
    rows.profitGrew.push(profitBefore ? quarter.value > profitBefore.value : null);
    const margin = sales && sales.value !== 0 ? quarter.value / sales.value : null;
    const marginBefore = salesBefore && salesBefore.value !== 0 && profitBefore ? profitBefore.value / salesBefore.value : null;
    rows.marginHeld.push(margin !== null && marginBefore !== null ? margin >= marginBefore - 0.01 : null);
  }
  return rows;
}

export type Totals = { revenue: Sourced | null; netIncome: Sourced | null; operatingIncome: Sourced | null };

/** The tag the operating cash flow is read from: the first that gives a twelve-month total at the newest quarter. */
export function cashFlowTag(source: FactSource, newest: string): string | null {
  for (const tag of OPERATING_CASH_FLOW_TAGS) {
    const facts = source.get(tag);
    if (facts.length && trailingTwelveMonths(facts, newest, source.series(tag))) return tag;
  }
  return null;
}

/** Months of spending the cash covers. null = unknown. */
export function monthsOfCash(liquid: number | null, ttmCashFlow: number | null): number | "cash-flow positive" | null {
  if (liquid === null || ttmCashFlow === null) return null;
  if (ttmCashFlow >= 0) return "cash-flow positive";
  return liquid / (-ttmCashFlow / 12);
}

export type GrowthResult = { rows: Rows; hasSales: boolean; months: (number | "cash-flow positive" | null)[]; shareGrowth: (number | null)[] };

/**
 * The growth rule set: five checks for a young company that is not profitable yet. With no meaningful sales
 * (none, or under a tenth of costs) the two sales checks do not count.
 */
export function growthRows(source: FactSource, m: Measures, four: readonly Point[], totals: Totals, used: (filed: string) => void): GrowthResult {
  const sales12 = totals.revenue?.value ?? 0;
  const result12 = totals.operatingIncome ?? totals.netIncome;
  const costs = result12 ? sales12 - result12.value : null;
  let hasSales = sales12 > 0 || four.some((q) => (m.revenue.series.at.get(q.end)?.value ?? 0) > 0);
  if (costs !== null && costs > 0 && sales12 < 0.1 * costs) hasSales = false;

  const newest = four[four.length - 1].end;
  const cashTag = cashFlowTag(source, newest);
  const firstReport = firstReportFiled(source);
  const rows = { salesGrew: [] as Answer[], closerToProfit: [] as Answer[], yearCash: [] as Answer[], twoYearsCash: [] as Answer[], fewNewShares: [] as Answer[] };
  const months: GrowthResult["months"] = [];
  const growth: (number | null)[] = [];

  for (const quarter of four) {
    const sales = m.revenue.series.at.get(quarter.end) ?? null;
    const salesBefore = sales ? yearAgo(m.revenue.series, quarter.end) : null;
    const operating = m.operatingIncome.series.at.get(quarter.end) ?? null;
    const result = operating ?? quarter;
    const resultBefore = yearAgo(operating ? m.operatingIncome.series : m.netIncome.series, quarter.end);
    for (const p of [quarter, sales, salesBefore, result, resultBefore]) if (p) used(p.filed);

    rows.salesGrew.push(hasSales && sales && salesBefore ? sales.value > salesBefore.value : null);

    let closer: Answer = null;
    if (hasSales) {
      if (result.value > 0) closer = true;
      else if (sales && sales.value !== 0 && salesBefore && salesBefore.value !== 0 && resultBefore) {
        closer = result.value / sales.value > resultBefore.value / salesBefore.value;
      }
    }
    rows.closerToProfit.push(closer);

    const liquid = liquidFunds(source, quarter.end);
    const cashFlow = ttmOf(source, OPERATING_CASH_FLOW_TAGS, quarter.end, cashTag);
    for (const p of [liquid, cashFlow]) if (p) used(p.filed);
    const covered = monthsOfCash(liquid?.value ?? null, cashFlow?.value ?? null);
    months.push(covered);
    rows.yearCash.push(covered === null ? null : covered === "cash-flow positive" || covered >= 12);
    rows.twoYearsCash.push(covered === null ? null : covered === "cash-flow positive" || covered >= 24);

    const shares = shareGrowth(source, quarter.end, firstReport);
    if (shares) used(shares.filed);
    growth.push(shares ? shares.value : null);
    rows.fewNewShares.push(shares ? shares.value <= MAX_SHARE_GROWTH : null);
  }
  return { rows, hasSales, months, shareGrowth: growth };
}

/* ---------------------------------------------------------------- the score */

function noScore(reason: string): HealthCheck {
  return { ruleSet: "standard", verdict: null, noScoreReason: reason, passed: 0, answered: 0, quarters: [], checks: [], notes: [] };
}

/** The day a quarter's figures first reached the SEC in an annual or quarterly report (any filing if there is none). */
function reportFiled(source: FactSource, tag: string | null, end: string): string | null {
  if (!tag) return null;
  const facts = source.get(tag).filter((f) => f.start !== null && f.end === end);
  const periodic = facts.filter((f) => isPeriodicForm(f.form));
  const pool = periodic.length ? periodic : facts;
  return pool.reduce<string | null>((first, f) => (first === null || f.filed < first ? f.filed : first), null);
}

/**
 * Scores one company from its SEC companyfacts file. Pure: the same inputs always give the same answer, and
 * odd or missing data never throws; it gives "no score" with a reason instead.
 */
export function scoreCompany(facts: unknown, profile: CompanyProfile, opts: ScoreOptions): Fundamentals {
  if (!opts || !isIsoDate(opts.today)) throw new RangeError("scoreCompany needs opts.today as an ISO date (YYYY-MM-DD)");
  const today = opts.today;
  const source = openFacts(facts);
  const who: CompanyProfile = { sic: profile?.sic ?? null, isEmergingGrowth: profile?.isEmergingGrowth ?? null };

  let sourceFiled: string | null = null;
  const used = (filed: string) => {
    if (filed && (sourceFiled === null || filed > sourceFiled)) sourceFiled = filed;
  };
  const take = (v: Sourced | null): number | null => {
    if (!v) return null;
    used(v.filed);
    return v.value;
  };

  const m = readMeasures(source);
  const income = m.netIncome.series.points;
  const newest = income.length ? income[income.length - 1].end : null;

  const quarters = income.slice(-QUARTERS_SHOWN).map((p) => {
    const revenue = m.revenue.series.at.get(p.end) ?? null;
    const operating = m.operatingIncome.series.at.get(p.end) ?? null;
    for (const x of [p, revenue, operating]) if (x) used(x.filed);
    return { end: p.end, revenue: revenue ? revenue.value : null, netIncome: p.value, operatingIncome: operating ? operating.value : null };
  });

  const totals: Totals = {
    revenue: newest && m.revenue.tag ? ttmOf(source, REVENUE_TAGS, newest, m.revenue.tag) : null,
    netIncome: newest ? ttmOf(source, NET_INCOME_TAGS, newest, m.netIncome.tag) : null,
    operatingIncome: newest ? ttmOf(source, OPERATING_INCOME_TAGS, newest, m.operatingIncome.tag) : null,
  };
  const cashFlow = newest ? ttmOf(source, OPERATING_CASH_FLOW_TAGS, newest, cashFlowTag(source, newest)) : null;
  const liquid = newest ? liquidFunds(source, newest) : null;
  const ttm = {
    revenue: take(totals.revenue),
    netIncome: take(totals.netIncome),
    operatingIncome: take(totals.operatingIncome),
    operatingCashFlow: take(cashFlow),
  };
  const liquidValue = take(liquid);
  const cash = {
    liquid: liquidValue,
    asOf: liquidValue === null ? null : newest,
    quarterlySpend: ttm.operatingCashFlow !== null && ttm.operatingCashFlow < 0 ? -ttm.operatingCashFlow / 4 : null,
    months: monthsOfCash(liquidValue, ttm.operatingCashFlow),
  };

  const health = ((): HealthCheck => {
    if (isFund(source, who, today)) return noScore(NO_SCORE.fund);
    const lastFour = income.slice(-4);
    const hadSales = lastFour.length
      ? lastFour.some((q) => (m.revenue.series.at.get(q.end)?.value ?? 0) > 0)
      : m.revenue.series.points.slice(-4).some((p) => p.value > 0);
    if (isBlankCheck(source, who, newest, hadSales)) return noScore(NO_SCORE.blankCheck);
    if (!NET_INCOME_TAGS.some((tag) => source.get(tag).some((f) => f.start !== null))) return noScore(NO_SCORE.noNumbers);
    if (newest === null) return noScore(NO_SCORE.notEnoughReports);
    if (daysBetween(newest, today) > STALE_AFTER_DAYS) return noScore(NO_SCORE.tooOld);
    if (lastFour.length < 4 || !areConsecutive(lastFour.map((q) => q.end))) return noScore(NO_SCORE.notEnoughReports);

    // The growth rules are reachable only through this one condition.
    const useGrowthRules =
      opts.growthRules === true &&
      who.isEmergingGrowth === true &&
      lostMoneyFromOperations({
        ttmOperatingIncome: ttm.operatingIncome,
        ttmNetIncome: ttm.netIncome,
        operatingIncomeQuarters: lastFour.map((q) => m.operatingIncome.series.at.get(q.end)?.value ?? null),
        netIncomeQuarters: lastFour.map((q) => q.value),
      }) === true;

    const ruleSet: RuleSet = useGrowthRules ? "growth" : "standard";
    const notes: string[] = [];
    let rows: Rows;
    let notCounted: CheckKey[] = [];
    if (useGrowthRules) {
      const growth = growthRows(source, m, lastFour, totals, used);
      rows = growth.rows;
      if (!growth.hasSales) {
        notCounted = ["salesGrew", "closerToProfit"];
        notes.push(NOTE_NO_SALES);
      }
    } else {
      rows = standardRows(m, lastFour, used);
    }

    const checks = RULE_SET_CHECKS[ruleSet].map((key) => ({
      key,
      label: CHECK_TEXT[key].label,
      hint: CHECK_TEXT[key].hint,
      answers: rows[key] ?? lastFour.map(() => null),
      counted: !notCounted.includes(key),
    }));
    const { verdict, passed, answered } = verdictOf(checks.filter((c) => c.counted).flatMap((c) => c.answers));
    return {
      ruleSet,
      verdict,
      noScoreReason: verdict === null ? NO_SCORE.notEnoughReports : null,
      passed,
      answered,
      quarters: lastFour.map((q) => ({ end: q.end, filed: reportFiled(source, m.netIncome.tag, q.end) })),
      checks,
      notes,
    };
  })();

  return { asOf: today, health, quarters, ttm, cash, sourceFiled };
}
