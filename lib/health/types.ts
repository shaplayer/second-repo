/**
 * Types for the health check: the Strong / Mixed / Weak label BigStocks gives a company from its SEC
 * financial data. Other code imports these from "lib/health" (index.ts).
 */

export type Verdict = "Strong" | "Mixed" | "Weak";

/** Which set of checks was used. "growth" stays switched off until the site owner approves it (plan decision 9). */
export type RuleSet = "standard" | "growth";

export type CheckKey =
  | "salesGrew"
  | "madeProfit"
  | "profitGrew"
  | "marginHeld"
  | "closerToProfit"
  | "yearCash"
  | "twoYearsCash"
  | "fewNewShares";

export type HealthCheck = {
  ruleSet: RuleSet;
  /** null = no score; noScoreReason then says why. */
  verdict: Verdict | null;
  /** Plain English, shown on the page when verdict is null. */
  noScoreReason: string | null;
  /** Only answers that count towards the verdict. */
  passed: number;
  answered: number;
  /** The four quarters used, oldest first (ISO dates). `filed` is the day the quarter's report reached the SEC. */
  quarters: { end: string; filed: string | null }[];
  /** Answers are oldest first, in the same order as `quarters`; null = no answer. */
  checks: { key: CheckKey; label: string; hint: string; answers: (boolean | null)[]; counted: boolean }[];
  /** Plain-English remarks for the page, e.g. "No sales yet, so the two sales checks don't count." */
  notes: string[];
};

export type Fundamentals = {
  /** The `today` passed in. */
  asOf: string;
  health: HealthCheck;
  /** Up to the last 8 quarters, oldest first. */
  quarters: { end: string; revenue: number | null; netIncome: number | null; operatingIncome: number | null }[];
  /** Totals for the last twelve months, up to the newest quarter. */
  ttm: { revenue: number | null; netIncome: number | null; operatingIncome: number | null; operatingCashFlow: number | null };
  /**
   * Cash and investments at the newest quarter end, and how long they last. `quarterlySpend` is the cash the
   * business used per quarter over the last twelve months (null when it brought cash in, or when unknown).
   */
  cash: { liquid: number | null; asOf: string | null; quarterlySpend: number | null; months: number | "cash-flow positive" | null };
  /** Newest `filed` date among the facts actually used. */
  sourceFiled: string | null;
};

/** What we know about the company apart from its numbers (from the SEC submissions file). */
export type CompanyProfile = { sic: string | null; isEmergingGrowth: boolean | null };

export type ScoreOptions = {
  /** ISO date (YYYY-MM-DD) the score is computed for. */
  today: string;
  /** false until the site owner approves the growth rule set; while false every company gets the standard rules. */
  growthRules: boolean;
};
