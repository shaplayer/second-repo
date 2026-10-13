---
name: market-data
description: How this project fetches and serves stock market data (quotes, price history, company profiles, news, ticker search). Use whenever adding or changing an API route, data provider, cache, or type that touches market data.
---

# Market data

## Rules
- **Never call a market-data provider from the browser.** API keys live in `.env.local` (never committed) and are read only in server code (API routes / server components). The frontend calls our own `/api/*` routes.
- Put every provider call behind one module, `lib/market/`, so swapping providers touches one place.
- Return **our own normalized types**, never raw provider JSON, to the UI.

## Normalized types
```ts
export type Quote = {
  symbol: string; name: string; exchange: string; currency: string;
  price: number; change: number; changePercent: number;
  previousClose: number; open: number; dayHigh: number; dayLow: number;
  volume: number; marketCap?: number; peRatio?: number; dividendYield?: number;
  week52High?: number; week52Low?: number;
  marketState: "PRE" | "REGULAR" | "POST" | "CLOSED";
  updatedAt: string; // ISO
};
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }; // t = unix ms
export type Range = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";
export type NewsItem = { title: string; url: string; source: string; publishedAt: string; imageUrl?: string };
export type SearchResult = { symbol: string; name: string; exchange: string; type: string };
```

## API routes
| Route | Returns |
|---|---|
| `GET /api/quote?symbols=AAPL,MSFT` | `Quote[]` |
| `GET /api/history?symbol=AAPL&range=1M` | `Candle[]` |
| `GET /api/search?q=app` | `SearchResult[]` (max 10) |
| `GET /api/news?symbol=AAPL` | `NewsItem[]` |

Range → interval: 1D→5min, 5D→30min, 1M/6M/YTD→1day, 1Y→1day, 5Y→1week, MAX→1month.

## Caching and rate limits
Free provider tiers are tightly rate limited, so cache server-side:
- Quotes: 15–60 s. History intraday: 1 min; daily+: 1 h. Profiles: 24 h. News: 5 min. Search: 24 h.
- On provider error or 429, serve the last cached value if one exists and include `stale: true`.
- Validate `symbol` (`/^[A-Z0-9.\-^=]{1,15}$/` after uppercasing) before calling a provider.

## Providers
Pick one via `MARKET_PROVIDER` env var. Good options: Finnhub, Alpha Vantage, Twelve Data, Financial Modeling Prep, Polygon. Check the provider's current docs for endpoints and limits rather than guessing. Free data is often delayed ~15 min; show "Delayed" in the UI when it is.

For local dev without a key, `MARKET_PROVIDER=mock` returns deterministic fake data from `lib/market/mock.ts`.
