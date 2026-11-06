/**
 * Long-term picks: big names BigStocks called before they ran.
 *
 * These were picked before the timestamped track record existed, so they are shown separately
 * and labeled "logged after the fact". Keep it honest: only list picks you can prove (an old
 * email, post or screenshot), and fill in `proof` with a link when you have one.
 *
 * Prices are split-adjusted closing prices in USD. `latest` is a manual snapshot: update it
 * (or wire it to a quote API) so the "since pick" number stays current.
 *
 * BEFORE LAUNCH: double-check every price below against your broker or Nasdaq.com history.
 * They were looked up from public sources, which didn't fully agree (see notes).
 */
export type LongTermPick = {
  ticker: string;
  name: string;
  pickedOn: string;            // YYYY-MM-DD (US Eastern trading day)
  priceAtPick: number | null;  // split-adjusted close on pickedOn; null = still being verified
  latest: { price: number; asOf: string } | null;
  thesis: string;
  proof?: string;              // URL to the original alert, post or screenshot
  note?: string;               // internal: where the numbers came from
};

export const LONG_TERM_PICKS: LongTermPick[] = [
  {
    ticker: "NVDA",
    name: "NVIDIA",
    pickedOn: "2024-07-10",
    priceAtPick: 134.54,
    latest: { price: 181.6, asOf: "2026-11-05" },
    thesis: "AI data-center demand. The GPU everyone needs.",
    note: "Jul 10 2024 close per StatMuse ($134.54; another StatMuse page says $134.69). Nov 5 2026 close per Motley Fool.",
  },
  {
    ticker: "AVGO",
    name: "Broadcom",
    pickedOn: "2024-07-10",
    priceAtPick: null,
    latest: { price: 291.54, asOf: "2026-11-05" },
    thesis: "Custom AI chips and networking for the hyperscalers.",
    note: "Jul 10 2024 close not confirmed yet (pre-split ~$1,7xx; divide by 10 for the Jul 15 2024 split). Jul 9 close was $1,733.31. Nov 5 2026 close per StockTitan.",
  },
  {
    ticker: "TSM",
    name: "Taiwan Semiconductor",
    pickedOn: "2024-07-10",
    priceAtPick: 191.05,
    latest: null,
    thesis: "Makes the chips for NVIDIA, Apple and AMD.",
    note: "Jul 10 2024 ADR close per Focus Taiwan / Lincoln Daily News ($191.05). Latest close not confirmed yet.",
  },
];

/** Percent gain from pick to latest, or null if either price is missing. */
export function pickGain(p: LongTermPick): number | null {
  if (p.priceAtPick == null || !p.latest) return null;
  return ((p.latest.price - p.priceAtPick) / p.priceAtPick) * 100;
}

export const fmtPickDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
