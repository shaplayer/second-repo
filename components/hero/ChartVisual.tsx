"use client";
import { useRef } from "react";
import { BRAND, DOWN, rng, useCanvas } from "./useCanvas";

type Candle = { o: number; h: number; l: number; c: number; v: number; tag?: string };

// Catalysts. Each one lands on a breakout candle: the story of the product.
const TAGS = ["8-K filed", "Earnings beat", "FDA approval", "Contract win", "Press release", "Guidance raised"];
const PERIOD = 950; // ms per candle

/**
 * Option C: a live candlestick chart that keeps climbing. Breakout candles are pinned
 * with the news that caused them (8-K, earnings, FDA...), so the chart says
 * "news breaks, the chart reacts, and we send you the news first". Illustrative, not real prices.
 */
export function ChartVisual({ className = "" }: { className?: string }) {
  const st = useRef<{ candles: Candle[]; rand: () => number; phase: number; target: number; lo: number; hi: number; tagI: number; sinceTag: number } | null>(null);

  const make = (rand: () => number, prev: number, s: { tagI: number; sinceTag: number }): Candle => {
    s.sinceTag++;
    const catalyst = s.sinceTag > 9 && rand() < 0.16;
    const move = catalyst ? 0.035 + rand() * 0.03 : (rand() - 0.44) * 0.022;
    const o = prev * (1 + (rand() - 0.5) * 0.004);
    const c = o * (1 + move);
    const h = Math.max(o, c) * (1 + rand() * (catalyst ? 0.012 : 0.008));
    const l = Math.min(o, c) * (1 - rand() * 0.008);
    const v = (catalyst ? 2.2 + rand() * 1.4 : 0.4 + rand() * 0.8);
    let tag: string | undefined;
    if (catalyst) { tag = TAGS[s.tagI % TAGS.length]; s.tagI++; s.sinceTag = 0; }
    return { o, h, l, c, v, tag };
  };

  const ref = useCanvas(({ ctx, w, h, dt }) => {
    const step = w < 480 ? 11 : 14;
    const body = Math.max(5, step - 5);
    const need = Math.ceil(w / step) + 3;

    if (!st.current) {
      const rand = rng(7);
      const s = { tagI: 0, sinceTag: 4 };
      const candles: Candle[] = [];
      let p = 100;
      for (let i = 0; i < 160; i++) { const k = make(rand, p, s); candles.push(k); p = k.c; }
      st.current = { candles, rand, phase: 0, target: 0, lo: 0, hi: 0, ...s };
    }
    const S = st.current;
    while (S.candles.length < need + 1) {
      const k = make(S.rand, S.candles[S.candles.length - 1].c, S);
      S.candles.push(k);
    }

    // Advance: the last candle "forms" live, then a new one starts and the chart slides left.
    S.phase += dt / PERIOD;
    const live = S.candles[S.candles.length - 1];
    if (S.phase >= 1) {
      S.phase = 0;
      const k = make(S.rand, live.c, S);
      S.target = k.c;
      k.c = k.o; k.h = k.o; k.l = k.o;
      S.candles.push(k);
      if (S.candles.length > 400) S.candles.splice(0, S.candles.length - 400);
    } else if (dt > 0 && S.target) {
      // Tick the live candle toward its close with a little noise.
      const n = (S.rand() - 0.5) * live.o * 0.004;
      live.c = live.o + (S.target - live.o) * Math.min(1, S.phase * 1.25) + n * (1 - S.phase);
      live.h = Math.max(live.h, live.c);
      live.l = Math.min(live.l, live.c);
    }

    const vis = S.candles.slice(-need);
    const offset = S.phase * step;
    const top = h * 0.12, bottom = h * 0.72, vTop = h * 0.8, vBottom = h * 0.97;

    // Smooth auto-scale.
    let lo = Infinity, hi = -Infinity, vMax = 0;
    for (const k of vis) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); vMax = Math.max(vMax, k.v); }
    const pad = (hi - lo) * 0.08;
    if (!S.lo) { S.lo = lo - pad; S.hi = hi + pad; }
    const ease = dt ? Math.min(1, dt / 400) : 1;
    S.lo += (lo - pad - S.lo) * ease;
    S.hi += (hi + pad - S.hi) * ease;
    const y = (p: number) => bottom - ((p - S.lo) / (S.hi - S.lo)) * (bottom - top);
    // Live candle starts 64px from the right edge (room for the LIVE tag) and slides left as it forms.
    const x = (i: number) => w - 64 - (vis.length - 1 - i) * step - offset;

    // Grid.
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = Math.round(top + ((bottom - top) * i) / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }

    // Moving average + glow area.
    const ma: [number, number][] = [];
    const all = S.candles, base = all.length - vis.length;
    for (let i = 0; i < vis.length; i++) {
      let sum = 0, n = 0;
      for (let j = Math.max(0, base + i - 11); j <= base + i; j++) { sum += all[j].c; n++; }
      ma.push([x(i), y(sum / n)]);
    }
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, `rgba(${BRAND},0.16)`);
    grad.addColorStop(1, `rgba(${BRAND},0)`);
    ctx.beginPath();
    ma.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.lineTo(ma[ma.length - 1][0], bottom); ctx.lineTo(ma[0][0], bottom); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    ma.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.strokeStyle = `rgba(${BRAND},0.5)`; ctx.lineWidth = 1.5; ctx.stroke();

    // Volume.
    vis.forEach((k, i) => {
      const up = k.c >= k.o;
      const vh = (k.v / vMax) * (vBottom - vTop);
      ctx.fillStyle = up ? `rgba(${BRAND},${k.tag ? 0.45 : 0.18})` : `rgba(${DOWN},0.16)`;
      ctx.fillRect(x(i) - body / 2, vBottom - vh, body, vh);
    });

    // Candles.
    vis.forEach((k, i) => {
      const up = k.c >= k.o, cx = Math.round(x(i)) + 0.5;
      const color = up ? `rgba(${BRAND},0.95)` : `rgba(${DOWN},0.85)`;
      const isLive = i === vis.length - 1;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      if (isLive || k.tag) { ctx.shadowColor = `rgba(${up ? BRAND : DOWN},0.8)`; ctx.shadowBlur = 14; }
      ctx.beginPath(); ctx.moveTo(cx, y(k.h)); ctx.lineTo(cx, y(k.l)); ctx.stroke();
      const by = y(Math.max(k.o, k.c)), bh = Math.max(1.5, Math.abs(y(k.o) - y(k.c)));
      ctx.fillRect(cx - body / 2, by, body, bh);
      ctx.shadowBlur = 0;
    });

    // News pins on breakout candles.
    ctx.font = "600 11px Inter Variable, ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    vis.forEach((k, i) => {
      if (!k.tag) return;
      const cx = x(i), hy = y(k.h);
      const tw = ctx.measureText(k.tag).width + 20, th = 22;
      const px = Math.min(Math.max(8, cx - tw / 2), w - tw - 8), py = Math.max(4, hy - 44);
      const a = Math.min(1, Math.max(0, (cx - 20) / 80)); // fade out at the left edge
      ctx.globalAlpha = a;
      ctx.setLineDash([2, 3]); ctx.strokeStyle = `rgba(${BRAND},0.6)`;
      ctx.beginPath(); ctx.moveTo(cx + 0.5, py + th); ctx.lineTo(cx + 0.5, hy - 4); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(10,14,16,0.92)"; ctx.strokeStyle = `rgba(${BRAND},0.55)`;
      ctx.beginPath(); ctx.roundRect(px, py, tw, th, 11); ctx.fill(); ctx.stroke();
      ctx.fillStyle = `rgb(${BRAND})`;
      ctx.beginPath(); ctx.arc(px + 10, py + th / 2, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e9eeeb"; ctx.fillText(k.tag, px + 16, py + th / 2 + 0.5);
      ctx.globalAlpha = 1;
    });

    // Live price line.
    const ly = Math.round(y(live.c)) + 0.5;
    ctx.setLineDash([3, 4]); ctx.strokeStyle = `rgba(${BRAND},0.45)`;
    ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w - 44, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = `rgb(${BRAND})`;
    ctx.beginPath(); ctx.roundRect(w - 42, ly - 10, 40, 20, 10); ctx.fill();
    ctx.fillStyle = "#04130b"; ctx.font = "700 10px Inter Variable, ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("LIVE", w - 34, ly + 0.5);
  });

  return (
    <canvas ref={ref} aria-hidden="true"
      className={`block h-full w-full [mask-image:linear-gradient(90deg,transparent,black_18%,black)] ${className}`} />
  );
}
