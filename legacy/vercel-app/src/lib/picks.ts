import { dailyBars, liveQuote, toDbSymbol, type Bar } from "./databento";
import { listPicks, type Pick } from "./store";

export type PickResult = Pick & {
  priceNow: number | null;
  returnPct: number | null; // since posted (or until closed)
  sp500Pct: number | null; // the S&P 500 (SPY) over the same days
};

/** Close on or before a moment; used to line a pick's start and end up with the S&P 500. */
function closeAt(bars: Bar[], iso: string) {
  const day = iso.slice(0, 10);
  const before = bars.filter((b) => b.t.slice(0, 10) <= day);
  return before.length ? before[before.length - 1].c : null;
}

/** Every pick with its result so far. Results are computed from market prices, never typed in. */
export async function picksWithResults(ticker?: string): Promise<PickResult[]> {
  const picks = await listPicks(ticker);
  if (!picks.length) return [];
  const symbols = [...new Set(picks.map((p) => toDbSymbol(p.ticker))), "SPY"];
  const bars = await dailyBars(symbols).catch(() => new Map<string, Bar[]>());
  const spy = bars.get("SPY") ?? [];
  // Same price source used when a pick is published, so a pick starts at exactly 0%.
  const live = new Map<string, number>();
  await Promise.all(
    [...new Set(picks.filter((p) => !p.closedAt).map((p) => toDbSymbol(p.ticker)))].map(async (sym) => {
      const q = await liveQuote(sym, bars.get(sym) ?? []).catch(() => null);
      if (q) live.set(sym, q.price);
    }),
  );
  return picks
    .map((p) => {
      const series = bars.get(toDbSymbol(p.ticker)) ?? [];
      const priceNow = p.priceAtClose ?? live.get(toDbSymbol(p.ticker)) ?? (series.length ? series[series.length - 1].c : null);
      const returnPct = priceNow !== null ? ((priceNow - p.priceAtPost) / p.priceAtPost) * 100 : null;
      const spyStart = closeAt(spy, p.postedAt);
      const spyEnd = p.closedAt ? closeAt(spy, p.closedAt) : spy.length ? spy[spy.length - 1].c : null;
      const sp500Pct = spyStart && spyEnd ? ((spyEnd - spyStart) / spyStart) * 100 : null;
      return { ...p, priceNow, returnPct, sp500Pct };
    })
    .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
}

export type TrackRecord = { count: number; avgReturn: number | null; beatMarket: number; winners: number };

/** Summary of results. Sponsored posts are ads, so they never count toward the picks' record. */
export function trackRecord(results: PickResult[]): TrackRecord {
  const scored = results.filter((r) => r.kind === "pick" && r.returnPct !== null);
  const avg = scored.length ? scored.reduce((s, r) => s + r.returnPct!, 0) / scored.length : null;
  return {
    count: scored.length,
    avgReturn: avg,
    beatMarket: scored.filter((r) => r.sp500Pct !== null && r.returnPct! > r.sp500Pct).length,
    winners: scored.filter((r) => r.returnPct! > 0).length,
  };
}
