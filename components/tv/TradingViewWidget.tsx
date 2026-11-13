"use client";

import { useEffect, useRef, useState } from "react";

type Kind = "symbol-info" | "advanced-chart" | "mini-symbol-overview";

/**
 * Prices and charts come from TradingView's own embed widgets, loaded by the visitor's browser.
 * Our server never fetches, stores or shows a price (CLAUDE.md). TradingView's "by TradingView" link
 * inside the widget is left visible, and we add our own line under it.
 *
 * If the widget does not load (blocked script, offline), the box says so and the rest of the page
 * keeps working.
 */
export function TradingViewWidget({ kind, symbol, height, label }: { kind: Kind; symbol: string; height: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const common = { colorTheme: "light", isTransparent: true, locale: "en", width: "100%" };
    const config =
      kind === "symbol-info" ? { ...common, symbol }
      : kind === "mini-symbol-overview" ? { ...common, symbol, height, dateRange: "1M", autosize: false, largeChartUrl: "" }
      : {
          ...common, symbol, height, autosize: false, interval: "D", timezone: "America/New_York", theme: "light", style: "1",
          allow_symbol_change: false, hide_side_toolbar: true, save_image: false, calendar: false, support_host: "https://www.tradingview.com",
        };
    const script = document.createElement("script");
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${kind}.js`;
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify(config);
    script.onerror = () => setFailed(true);
    el.appendChild(script);
    // No frame after a while means it was blocked or could not load.
    const t = setTimeout(() => {
      if (!el.querySelector("iframe")) setFailed(true);
    }, 12_000);
    return () => {
      clearTimeout(t);
      el.innerHTML = "";
    };
  }, [kind, symbol, height]);

  if (failed) {
    return (
      <div role="status" className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-inset px-4 text-center" style={{ minHeight: Math.min(height, 180) }}>
        <span className="text-[15px] font-bold">Chart unavailable</span>
        <span className="text-[13px] text-muted">The price chart didn&apos;t load. News, filings and the health check still work.</span>
      </div>
    );
  }
  return <div ref={box} className="tradingview-widget-container" aria-label={label} style={{ minHeight: kind === "symbol-info" ? 110 : height }} />;
}

/** The line that goes under every chart. */
export const TradingViewCredit = ({ className = "" }: { className?: string }) => (
  <span className={`text-[11px] text-muted ${className}`}>
    Price data and charts by{" "}
    <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="text-muted underline">TradingView</a>
  </span>
);
