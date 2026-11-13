/**
 * The health check: a Strong / Mixed / Weak label worked out from a company's SEC financial data.
 * It describes the numbers a company has reported; it is not investment advice.
 *
 *   import { scoreCompany, saveSnapshot } from "@/lib/health";
 */
export type { CheckKey, CompanyProfile, Fundamentals, HealthCheck, RuleSet, ScoreOptions, Verdict } from "./types";
export { scoreCompany } from "./score";
export { saveSnapshot } from "./snapshot";
export { CHECK_TEXT, NO_SCORE, NOT_ADVICE, NOTE_BOTTOM_LINE, NOTE_NO_SALES, RULE_SET_CHECKS } from "./labels";
