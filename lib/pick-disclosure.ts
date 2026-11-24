import type { StockPick } from "./data/picks";
import { dateET } from "./time";

/** The sentence that must accompany a sponsored pick everywhere it appears: page, email, text. */
export function sponsorLine(p: StockPick): string | null {
  if (!p.sponsored) return null;
  if (p.sponsor) return `Sponsored. Paid for by ${p.sponsor.payer}: ${p.sponsor.amount}, ${p.sponsor.form}. Start date: ${dateET(p.startsAt)}.`;
  return p.disclosureText?.trim() || "Sponsored.";
}
