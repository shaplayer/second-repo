"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { money, pct, upDown } from "@/lib/format";
import { useWatchlist } from "./useWatchlist";

type Row = { symbol: string; name: string; price?: number; changePct?: number };

export default function Watchlist() {
  const router = useRouter();
  const { list, remove } = useWatchlist();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, string | null>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!list) return;
    if (!list.length) return setRows([]);
    fetch(`/api/quotes?symbols=${list.join(",")}`)
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setRows(d) : setError(d.error ?? "Prices are unavailable right now.")))
      .catch(() => setError("Prices are unavailable right now."));
    for (const t of list) {
      fetch(`/api/score?symbol=${t}`)
        .then((r) => r.json())
        .then((d) => setVerdicts((v) => ({ ...v, [t]: d.verdict })))
        .catch(() => {});
    }
  }, [list]);

  return (
    <section className="panel">
      <header>
        <h2>Your watchlist</h2>
        <span className="small muted">{list ? `${list.length} stocks` : ""}</span>
      </header>
      {error && <div className="empty">{error}</div>}
      {!error && rows === null && <div className="empty">Loading prices…</div>}
      {rows?.length === 0 && <div className="empty">Search for a stock and press “Add to watchlist” to follow it here.</div>}
      <div className="rows">
        {rows
          ?.filter((r) => list?.includes(r.symbol))
          .map((r) => (
            <div
              key={r.symbol}
              className="row wl-row"
              role="link"
              tabIndex={0}
              style={{ cursor: "pointer" }}
              onClick={() => router.push(`/stock/${r.symbol}`)}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/stock/${r.symbol}`)}
            >
              <span className="tick">{r.symbol}</span>
              <span className="name small">{r.name}</span>
              <span className="hide-sm">
                {verdicts[r.symbol] !== undefined && (
                  <span className={`pill v-${verdicts[r.symbol] ?? "none"}`}>{verdicts[r.symbol] ?? "No score"}</span>
                )}
              </span>
              <span className="num hide-sm" style={{ textAlign: "right" }}>
                {r.price !== undefined ? money(r.price) : "—"}
              </span>
              <span className={`chg ${upDown(r.changePct ?? 0)}`}>{r.changePct !== undefined ? pct(r.changePct) : "—"}</span>
              <button
                className="x"
                aria-label={`Remove ${r.symbol} from watchlist`}
                title="Remove from watchlist"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(r.symbol);
                }}
              >
                ×
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}
