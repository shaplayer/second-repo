---
name: stock-charts
description: How price charts work on BigStocks (TradingView embed widgets only). Use whenever adding or changing a price chart, a sparkline, a quote, or anything that shows a price.
---

# Charts on BigStocks

Every price and chart is a TradingView embed widget in the visitor's browser. We do not draw our own
price charts, and our server never has a price to draw.

- Use `TradingViewWidget` from `components/tv/TradingViewWidget.tsx`. Kinds in use: `symbol-info`
  (the quote line), `advanced-chart` (the stock page), `mini-symbol-overview` (cards and side columns).
- The symbol comes from `companies.tv_symbol` (for example `NASDAQ:AAPL`). No symbol, no chart: show
  the plain sentence the stock page uses.
- Put `TradingViewCredit` under every chart and leave TradingView's own link inside the widget visible.
- If the widget does not load, the component shows "Chart unavailable" and the rest of the page keeps
  working. Keep that behaviour.
- TradingView's script and frames are allowed in the Content Security Policy in `next.config.ts`.
  A new widget from another host needs the owner's OK and a change there.
- Company numbers from SEC filings (sales, cash) are not prices. Format them with `money()` in
  `lib/time.ts`.
