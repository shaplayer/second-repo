"use client";
import { useRef } from "react";
import { BRAND, DOWN, rng, useCanvas } from "./useCanvas";

type P = { u: number; o: number; sp: number; down: boolean; split: number; px: number; py: number };
type Chip = { u: number; sp: number; ticker: string; up: boolean; lane: number };

/**
 * Option B: money flowing through the market. A river of trades streams left to right and climbs;
 * sellers peel off and fall away in red. Tickers from the live feed ride the current.
 * Illustrative: no prices or percentages.
 */
export function FlowVisual({ tickers = [], className = "" }: { tickers?: string[]; className?: string }) {
  const st = useRef<{ ps: P[]; chips: Chip[]; rand: () => number } | null>(null);
  const names = (tickers.length >= 4 ? tickers : ["NVDA", "AVGO", "TSM", "AAPL", "AMD", "MSFT"]).slice(0, 7);

  const ref = useCanvas(({ ctx, w, h, t, dt }) => {
    if (!st.current) {
      const rand = rng(11);
      const n = Math.round(Math.min(900, Math.max(260, (w * h) / 420)));
      const ps: P[] = Array.from({ length: n }, () => spawn(rand, rand()));
      const chips: Chip[] = names.map((ticker, i) => ({
        u: i / names.length, sp: 0.000035 + rand() * 0.00002, ticker, up: i % 4 !== 2, lane: (rand() - 0.5) * 1.6,
      }));
      st.current = { ps, chips, rand };
    }
    const S = st.current;

    const center = (u: number) =>
      h * 0.8 - Math.pow(u, 1.3) * h * 0.58 + Math.sin(u * 7 + t * 0.0005) * h * 0.025;
    const spread = (u: number) => h * (0.025 + 0.085 * u);
    const pos = (p: { u: number; o: number; down?: boolean; split?: number }) => {
      let y = center(p.u) + p.o * spread(p.u);
      if (p.down && p.split != null && p.u > p.split) y += Math.pow((p.u - p.split) * 2.2, 2) * h * 0.45;
      return [p.u * w, y] as const;
    };

    // Faint guide: the trend the flow follows.
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) { const u = i / 60; const yy = center(u); i ? ctx.lineTo(u * w, yy) : ctx.moveTo(0, yy); }
    ctx.strokeStyle = `rgba(${BRAND},0.18)`; ctx.lineWidth = 1; ctx.setLineDash([2, 6]); ctx.stroke(); ctx.setLineDash([]);

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const p of S.ps) {
      p.u += p.sp * (dt || 16);
      if (p.u > 1.02) Object.assign(p, spawn(S.rand, 0));
      const [x, y] = pos(p);
      if (p.px >= 0 && dt) {
        const fade = Math.sin(Math.min(1, Math.max(0, p.u)) * Math.PI);
        const a = (p.down ? 0.55 : 0.5) * fade;
        ctx.strokeStyle = `rgba(${p.down && p.u > p.split ? DOWN : BRAND},${a})`;
        ctx.lineWidth = p.down ? 1.4 : 1.2;
        ctx.beginPath(); ctx.moveTo(p.px - (x - p.px) * 2.5, p.py - (y - p.py) * 2.5); ctx.lineTo(x, y); ctx.stroke();
      } else if (!dt) {
        // Reduced motion: draw dots once.
        ctx.fillStyle = `rgba(${p.down && p.u > p.split ? DOWN : BRAND},0.45)`;
        ctx.fillRect(x, y, 1.6, 1.6);
      }
      p.px = x; p.py = y;
    }
    ctx.globalCompositeOperation = "source-over";

    // Ticker chips riding the flow.
    ctx.font = "600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";
    for (const c of S.chips) {
      c.u += c.sp * (dt || 0);
      if (c.u > 1.05) c.u = -0.05;
      const split = 0.45;
      const [x, y0] = pos({ u: c.u, o: c.lane, down: !c.up, split });
      const y = y0 - 16;
      const label = `${c.up ? "▲" : "▼"} $${c.ticker}`;
      const tw = ctx.measureText(label).width + 18, th = 22;
      const a = Math.sin(Math.min(1, Math.max(0, c.u)) * Math.PI);
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.fillStyle = "rgba(10,14,16,0.9)";
      ctx.strokeStyle = c.up ? `rgba(${BRAND},0.5)` : `rgba(${DOWN},0.5)`;
      ctx.beginPath(); ctx.roundRect(x - tw / 2, y - th / 2, tw, th, 11); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.up ? `rgb(${BRAND})` : `rgb(${DOWN})`;
      ctx.fillText(label, x - tw / 2 + 9, y + 0.5);
      ctx.globalAlpha = 1;
    }
  });

  return (
    <canvas ref={ref} aria-hidden="true"
      className={`block h-full w-full [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)] ${className}`} />
  );
}

function spawn(rand: () => number, u: number): P {
  // Box-Muller for a soft-edged band.
  const g = Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
  return {
    u: u - rand() * 0.05, o: Math.max(-2.2, Math.min(2.2, g)) * 0.6,
    sp: 0.00009 + rand() * 0.00012, down: rand() < 0.14, split: 0.25 + rand() * 0.5, px: -1, py: -1,
  };
}
