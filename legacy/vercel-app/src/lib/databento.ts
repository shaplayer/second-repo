import { cached } from "./cache";
import { etParts, inRegularSession } from "./time";

// Databento historical API. Daily bars come from EQUS.SUMMARY (consolidated US
// equities); intraday bars come from EQUS.MINI.
const BASE = "https://hist.databento.com/v0";
const DAILY = "EQUS.SUMMARY";
const INTRADAY = "EQUS.MINI";

export type Bar = { t: string; o: number; h: number; l: number; c: number; v: number; symbol: string };

function authHeader() {
  const key = process.env.DATABENTO_API_KEY;
  if (!key) throw new Error("DATABENTO_API_KEY is missing from .env");
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

/** revalidate: seconds the response may be shared from Vercel's cache across all visitors. */
async function get(path: string, params: Record<string, string>, revalidate: number) {
  const res = await fetch(`${BASE}/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: authHeader() },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`Databento ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.text();
}

function datasetEnd(dataset: string) {
  return cached(`db-end:${dataset}`, 60_000, async () => {
    const json = JSON.parse(await get("metadata.get_dataset_range", { dataset }, 60));
    return json.end as string;
  });
}

async function fetchBars(dataset: string, schema: string, symbols: string[], start: Date, revalidate: number): Promise<Bar[]> {
  const end = await datasetEnd(dataset);
  const csv = await get("timeseries.get_range", {
    dataset,
    schema,
    symbols: symbols.join(","),
    stype_in: "raw_symbol",
    start: start.toISOString(),
    end,
    encoding: "csv",
    pretty_px: "true",
    pretty_ts: "true",
    map_symbols: "true",
  }, revalidate);
  const lines = csv.trim().split("\n");
  const head = lines.shift()?.split(",") ?? [];
  const ix = (name: string) => head.indexOf(name);
  const [it, io, ih, il, ic, iv, is] = ["ts_event", "open", "high", "low", "close", "volume", "symbol"].map(ix);
  return lines.filter(Boolean).map((line) => {
    const f = line.split(",");
    return { t: f[it], o: +f[io], h: +f[ih], l: +f[il], c: +f[ic], v: +f[iv], symbol: f[is] };
  });
}

// Start at midnight UTC so the request URL stays the same all day and can be cached.
const dayStart = (n: number) => new Date(new Date(Date.now() - n * 864e5).toISOString().slice(0, 10) + "T00:00:00Z");

/** Up to two years of daily bars per symbol. */
export function dailyBars(symbols: string[]): Promise<Map<string, Bar[]>> {
  const key = [...symbols].sort().join(",");
  return cached(`daily:${key}`, 5 * 60_000, async () => {
    const bars = await fetchBars(DAILY, "ohlcv-1d", symbols, dayStart(740), 300);
    const by = new Map<string, Bar[]>();
    for (const b of bars) by.set(b.symbol, [...(by.get(b.symbol) ?? []), b]);
    return by;
  });
}

/** Short daily history for many symbols (homepage lists). */
export function recentDaily(symbols: string[]): Promise<Map<string, Bar[]>> {
  const key = [...symbols].sort().join(",");
  return cached(`recent:${key}`, 5 * 60_000, async () => {
    const bars = await fetchBars(DAILY, "ohlcv-1d", symbols, dayStart(10), 300);
    const by = new Map<string, Bar[]>();
    for (const b of bars) by.set(b.symbol, [...(by.get(b.symbol) ?? []), b]);
    return by;
  });
}

/** Regular-session 1-minute bars for the most recent trading day. */
export function lastSession(symbol: string): Promise<Bar[]> {
  return cached(`session:${symbol}`, 60_000, async () => {
    const bars = (await fetchBars(INTRADAY, "ohlcv-1m", [symbol], dayStart(5), 60)).filter((b) =>
      inRegularSession(new Date(b.t)),
    );
    if (!bars.length) return [];
    const lastDay = etParts(new Date(bars[bars.length - 1].t)).date;
    return bars.filter((b) => etParts(new Date(b.t)).date === lastDay);
  });
}

/** Regular-session hourly bars for the last five trading days. */
export function fiveDay(symbol: string): Promise<Bar[]> {
  return cached(`5d:${symbol}`, 5 * 60_000, async () => {
    const bars = (await fetchBars(INTRADAY, "ohlcv-1h", [symbol], dayStart(9), 300)).filter((b) => {
      const { hour } = etParts(new Date(b.t));
      return hour >= 9 && hour < 16;
    });
    const days = [...new Set(bars.map((b) => etParts(new Date(b.t)).date))].slice(-5);
    return bars.filter((b) => days.includes(etParts(new Date(b.t)).date));
  });
}

export type Quote = {
  symbol: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  volume: number;
  asOf: string;
};

/** Latest close vs. the close before it, from daily bars. */
export function quoteFromDaily(symbol: string, bars: Bar[] | undefined): Quote | null {
  if (!bars || bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  return {
    symbol,
    price: last.c,
    prevClose: prev.c,
    change: last.c - prev.c,
    changePct: ((last.c - prev.c) / prev.c) * 100,
    volume: last.v,
    asOf: last.t,
  };
}

/** Best available price for one stock: the latest minute bar, compared with the prior session's close. */
export async function liveQuote(symbol: string, daily: Bar[]): Promise<Quote | null> {
  const session = await lastSession(symbol).catch(() => []);
  if (!session.length) return quoteFromDaily(symbol, daily);
  const last = session[session.length - 1];
  const sessionDay = etParts(new Date(last.t)).date;
  const prior = daily.filter((b) => b.t.slice(0, 10) < sessionDay);
  const prevClose = prior.length ? prior[prior.length - 1].c : session[0].o;
  return {
    symbol,
    price: last.c,
    prevClose,
    change: last.c - prevClose,
    changePct: ((last.c - prevClose) / prevClose) * 100,
    volume: session.reduce((a, b) => a + b.v, 0),
    asOf: last.t,
  };
}

/** Databento uses BRK.B where the SEC uses BRK-B. */
export const toDbSymbol = (ticker: string) => ticker.replace("-", ".");
