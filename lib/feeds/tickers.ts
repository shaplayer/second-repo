import { cached, fetchText } from "./http";
import { EDGAR_TICKERS_URL } from "./sources";

type TickerMap = {
  byCik: Map<number, { ticker: string; name: string }>;
  byTicker: Map<string, { cik: number; name: string }>;
};

/** SEC's official ticker <-> CIK map (refreshed daily). */
export function tickerMap(): Promise<TickerMap> {
  return cached("sec:tickers", 24 * 60 * 60 * 1000, async () => {
    const raw = JSON.parse(await fetchText(EDGAR_TICKERS_URL, 15000)) as Record<
      string,
      { cik_str: number; ticker: string; title: string }
    >;
    const byCik: TickerMap["byCik"] = new Map();
    const byTicker: TickerMap["byTicker"] = new Map();
    for (const r of Object.values(raw)) {
      const ticker = r.ticker.toUpperCase();
      if (!byCik.has(r.cik_str)) byCik.set(r.cik_str, { ticker, name: r.title });
      byTicker.set(ticker, { cik: r.cik_str, name: r.title });
    }
    return { byCik, byTicker };
  });
}

export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
export const normalizeTicker = (t: string | null | undefined) => {
  const s = (t ?? "").trim().toUpperCase().replace(/^\$/, "");
  return TICKER_RE.test(s) ? s : null;
};
