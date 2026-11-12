"use client";

import Link from "next/link";
import { useState } from "react";
import { money, pct, upDown } from "@/lib/format";

export type TrendRow = { symbol: string; name: string; price: number; changePct: number; volume: number };

const TABS = [
  ["gainers", "Gainers"],
  ["losers", "Losers"],
  ["active", "Most active"],
] as const;

export default function MarketTrends({ rows }: { rows: TrendRow[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("gainers");
  const list =
    tab === "gainers"
      ? [...rows].sort((a, b) => b.changePct - a.changePct).filter((r) => r.changePct > 0)
      : tab === "losers"
        ? [...rows].sort((a, b) => a.changePct - b.changePct).filter((r) => r.changePct < 0)
        : [...rows].sort((a, b) => b.volume * b.price - a.volume * a.price);
  return (
    <section className="panel">
      <header>
        <h2>Market trends</h2>
        <div className="seg">
          {TABS.map(([k, label]) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="rows">
        {list.length === 0 && <div className="empty">Nothing to show.</div>}
        {list.slice(0, 8).map((r) => (
          <Link key={r.symbol} href={`/stock/${r.symbol}`} className="row trend-row">
            <span className="tick">{r.symbol}</span>
            <span className="small" style={{ minWidth: 0 }}>
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
              <span className="num muted">{money(r.price)}</span>
            </span>
            <span className={`chg ${upDown(r.changePct)}`}>{pct(r.changePct)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
