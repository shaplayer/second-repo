/**
 * Every word of the health check that a visitor can see. Plain English for non-experts: no form codes,
 * and never a recommendation to trade. The health check describes SEC financial data; it is not investment advice.
 */
import type { CheckKey, RuleSet } from "./types";

export const CHECK_TEXT: Record<CheckKey, { label: string; hint: string }> = {
  salesGrew: { label: "Sales grew", hint: "Compared with the same quarter a year ago" },
  madeProfit: { label: "Made a profit", hint: "Earned more than it spent in the quarter" },
  profitGrew: { label: "Profit grew", hint: "Compared with the same quarter a year ago" },
  marginHeld: { label: "Profit margin held up", hint: "Kept about the same share of each sales dollar as a year ago" },
  closerToProfit: { label: "Got closer to profit", hint: "Lost a smaller share of sales than a year ago, or made an operating profit" },
  yearCash: { label: "A year of cash or more", hint: "Cash and investments cover at least 12 months of spending" },
  twoYearsCash: { label: "Two years of cash or more", hint: "Cash and investments cover at least 24 months of spending" },
  fewNewShares: { label: "Few new shares issued", hint: "Share count up 20% or less on a year ago" },
};

/** The checks of each rule set, in the order the page shows them. */
export const RULE_SET_CHECKS: Record<RuleSet, readonly CheckKey[]> = {
  standard: ["salesGrew", "madeProfit", "profitGrew", "marginHeld"],
  growth: ["salesGrew", "closerToProfit", "yearCash", "twoYearsCash", "fewNewShares"],
};

/** Why a company has no Strong / Mixed / Weak label. */
export const NO_SCORE = {
  notEnoughReports: "Not enough quarterly reports yet (needs 4). Shows up after the company's next quarterly report.",
  tooOld: "The company's latest quarterly report is too old to score.",
  blankCheck: "Blank-check companies (SPACs) get no health check.",
  fund: "Funds get no health check.",
  noNumbers: "This company's SEC filings don't include the numbers the health check needs.",
} as const;

export const NOTE_NO_SALES = "No sales yet, so the two sales checks don't count.";

/** Shown wherever a verdict is shown. */
export const NOT_ADVICE = "Based on SEC financial data only. Not investment advice.";
