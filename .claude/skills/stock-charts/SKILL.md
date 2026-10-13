---
name: stock-charts
description: How to build the Google Finance–style price chart (range tabs, green/red line, previous-close baseline, hover crosshair) and small sparklines. Use whenever creating or changing any price chart or sparkline.
---

# Stock charts

Use **TradingView `lightweight-charts`** for the main chart (fast, finance-native time axis). Sparklines can be a tiny inline SVG `<polyline>`; no library needed.

## Main chart behavior (match Google Finance)
- Range tabs above the chart: `1D 5D 1M 6M YTD 1Y 5Y MAX`. Default `1D`. Selected tab is underlined; switching refetches `/api/history`.
- **Color**: green (`--up`) if last price ≥ the baseline, red (`--down`) otherwise. Baseline is previous close for `1D`, otherwise the first candle's close in the range.
- Area series: line in the up/down color, fill fading from ~20 % opacity to 0.
- For `1D`, draw a dashed horizontal line at previous close labeled "Previous close <value>".
- Hover: vertical crosshair, no horizontal one. While hovering, the header price/change above the chart updates to the hovered point (change relative to baseline) and the date/time shows under it. On mouse leave, restore live values.
- The change shown next to the range tabs reflects the selected range, e.g. `+12.40 (+5.6%) past month`.
- Hide the grid, keep only a light right-side price scale, and no chart watermark.
- Time axis in the **exchange's timezone** (e.g. America/New_York for US stocks), not the viewer's.
- Resize with the container (`ResizeObserver`); dispose the chart on unmount.
- Show a skeleton while loading and a short "Chart unavailable" message on error, never a blank box.

## Colors
Define in CSS and read them at runtime so dark mode works:
```css
:root { --up: #137333; --down: #a50e0e; }
@media (prefers-color-scheme: dark) { :root { --up: #81c995; --down: #f28b82; } }
```
