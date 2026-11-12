"use client";

import { useEffect, useRef, useState } from "react";
import { money, pct, upDown } from "@/lib/format";

const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "2Y"] as const;
type Range = (typeof RANGES)[number];
type Data = { intraday: boolean; base: number | null; points: { t: string; c: number }[] };

const W = 640;
const H = 240;
const RIGHT = 64;
const PAD = 14;

function label(t: string, range: Range) {
  const d = new Date(t);
  if (range === "1D") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  if (range === "5D")
    return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function PriceChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<Range>("1D");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setData(null);
    setError("");
    fetch(`/api/chart?symbol=${symbol}&range=${range}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError("Chart data is unavailable right now.") : setData(d)))
      .catch(() => setError("Chart data is unavailable right now."));
  }, [symbol, range]);

  const pts = data?.points ?? [];
  const base = data?.base ?? pts[0]?.c ?? 0;
  const last = pts[pts.length - 1]?.c ?? 0;
  const values = pts.map((p) => p.c).concat(range === "1D" && base ? [base] : []);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (pts.length > 1 ? (i * (W - RIGHT)) / (pts.length - 1) : 0);
  const y = (v: number) => PAD + ((max - v) / (max - min || 1)) * (H - 2 * PAD);
  const up = last >= base;
  const color = up ? "var(--green)" : "var(--down)";
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.c).toFixed(1)}`).join(" ");
  const change = last - base;
  const shown = hover !== null ? pts[hover] : null;

  const onMove = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || pts.length < 2) return;
    const px = ((clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round((px / (W - RIGHT)) * (pts.length - 1)))));
  };

  return (
    <section className="panel">
      <header>
        <span className="num">
          {pts.length > 1 && (
            <>
              <span className={upDown(change)}>
                {pct((change / base) * 100)} ({change >= 0 ? "+" : "−"}
                {money(Math.abs(change)).slice(1)})
              </span>{" "}
              <span className="muted small">
                {shown ? `${money(shown.c)} · ${label(shown.t, range)}` : { "1D": "today", "5D": "past 5 days", "1M": "past month", "6M": "past 6 months", YTD: "this year", "1Y": "past year", "2Y": "past 2 years" }[range]}
              </span>
            </>
          )}
        </span>
        <div className="seg" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </header>
      <div className="chart-box">
        {error && <div className="empty">{error}</div>}
        {!error && !data && <div className="empty" style={{ height: 200 }}>Loading chart…</div>}
        {data && pts.length < 2 && <div className="empty">No trades in this period.</div>}
        {pts.length > 1 && (
          <svg
            ref={svg}
            className="chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${symbol} price, ${range}`}
            onMouseMove={(e) => onMove(e.clientX)}
            onTouchMove={(e) => onMove(e.touches[0].clientX)}
            onMouseLeave={() => setHover(null)}
            onTouchEnd={() => setHover(null)}
          >
            <defs>
              <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity="0.22" />
                <stop offset="1" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[max, (max + min) / 2, min].map((v, i) => (
              <g key={i}>
                <line x1="0" x2={W - RIGHT} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="3 4" />
                <text x={W - RIGHT + 8} y={y(v) + 4}>
                  {v.toFixed(2)}
                </text>
              </g>
            ))}
            {range === "1D" && base > 0 && (
              <line x1="0" x2={W - RIGHT} y1={y(base)} y2={y(base)} stroke="var(--muted)" strokeDasharray="1 3" />
            )}
            <path d={`${d} L${x(pts.length - 1)} ${H} L0 ${H} Z`} fill="url(#area)" />
            <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
            {hover !== null ? (
              <>
                <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--muted)" strokeWidth="1" />
                <circle cx={x(hover)} cy={y(pts[hover].c)} r="4.5" fill={color} />
              </>
            ) : (
              <circle cx={x(pts.length - 1)} cy={y(last)} r="4.5" fill={color} />
            )}
          </svg>
        )}
        {range === "1D" && pts.length > 1 && <div className="disc">Dotted line: previous close {money(base)}</div>}
      </div>
    </section>
  );
}
