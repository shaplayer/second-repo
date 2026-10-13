---
name: finance-ui
description: Layout, components, and number formatting for the Google Finance–style stock website (home page, ticker page, search, watchlist). Use whenever building or changing pages or UI components, or formatting prices, percentages, or large numbers.
---

# Finance UI

## Stack
Next.js (App Router) + TypeScript + Tailwind, unless the repo already uses something else. Data comes only from our `/api/*` routes (see the `market-data` skill); charts follow the `stock-charts` skill.

## Pages
- **Home `/`**: search bar; "Market summary" row (S&P 500, Dow, Nasdaq, plus a few others) each with value, change, sparkline; "You may be interested in" list; market news; watchlist if one exists.
- **Ticker `/quote/[symbol]`** (e.g. `/quote/AAPL:NASDAQ` or `/quote/AAPL`):
  1. Breadcrumb (`Home > AAPL`), company name, big price, change and % change colored with an up/down arrow, "Closed: Oct 13, 4:00 PM EDT · USD · NASDAQ · Disclaimer". After-hours price on a second line when available.
  2. Price chart with range tabs.
  3. Right column (stacks below on mobile) **key stats** table: Previous close, Day range, Year range, Market cap, Avg volume, P/E ratio, Dividend yield, Primary exchange.
  4. "About" company blurb, then news list (source · relative time · title, thumbnail on right).
  5. "Compare to" chips for related tickers.
- **Search**: debounced (250 ms) autocomplete calling `/api/search`; arrow keys + Enter select; `/` focuses the search bar.
- **Watchlist**: stored in `localStorage` until there are user accounts; add/remove with a "+ Follow" button on the ticker page.

## Formatting (put these in `lib/format.ts` and always use them)
- Prices: `Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 })`; use up to 4 decimals for prices < 1.
- Change: always show a sign: `+1.23`, `-0.45`; percent as `+1.23%`.
- Large numbers: `1.23T`, `456.70B`, `12.30M`, `987.65K` (market cap, volume).
- Missing values: show `-`, never `NaN`, `undefined`, or `0`.
- Timestamps: exchange timezone with zone abbreviation (`4:00 PM EDT`); news uses relative time (`3 hours ago`).

## Visual style
- Clean, white background, lots of whitespace, one sans-serif font (e.g. Inter / Roboto), tabular numbers (`font-variant-numeric: tabular-nums`) everywhere a number appears.
- Up = green, down = red, unchanged = gray; use the `--up`/`--down` CSS variables. Never rely on color alone: also show the sign or arrow.
- Support dark mode via `prefers-color-scheme`.
- Responsive: one column under 768 px, no horizontal page scroll.

## Required
- Footer disclaimer: data may be delayed and is not investment advice; credit the data provider.
- Loading skeletons for every async section; a friendly "Couldn't find that symbol" page for bad tickers.
