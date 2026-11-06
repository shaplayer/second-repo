"use client";
import { useEffect, useMemo, useState } from "react";
import type { FeedItem } from "@/lib/feeds/types";
import { rng } from "./useCanvas";

type Note = { id: string; kind: "alert" | "filing" | "press"; title: string; body: string };

/** Turn real feed items into the notifications a subscriber would get. */
function buildNotes(items: FeedItem[]): Note[] {
  const withTicker = items.filter((i) => i.ticker).slice(0, 6);
  const notes: Note[] = withTicker.map((it) => it.kind === "filing"
    ? { id: it.id, kind: "filing", title: `New ${it.formType ?? "SEC filing"} from $${it.ticker}`, body: it.title }
    : { id: it.id, kind: "press", title: `$${it.ticker} press release`, body: it.title });
  const pick: Note = { id: "pick", kind: "alert", title: "Today's pick is live", body: "Our scanners flagged a setup. Open BigStocks to see the ticker." };
  if (!notes.length) {
    notes.push(
      { id: "f", kind: "filing", title: "New 8-K filing", body: "A company you follow just filed with the SEC." },
      { id: "p", kind: "press", title: "Press release", body: "Breaking news from a company you follow." },
    );
  }
  notes.splice(1, 0, pick);
  return notes;
}

/** Smooth rising price line for the backdrop (illustrative). */
function linePath(w: number, h: number) {
  const r = rng(3);
  const pts: [number, number][] = [];
  let v = 0.18;
  for (let i = 0; i <= 48; i++) {
    v += (r() - 0.38) * 0.05 + (i === 30 ? 0.12 : 0);
    v = Math.min(0.95, Math.max(0.05, v));
    pts.push([(i / 48) * w, h - v * h * 0.8 - h * 0.08]);
  }
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return { d, area: `${d} L${w},${h} L0,${h} Z`, end: pts[pts.length - 1] };
}

/**
 * Option A: what subscribers actually get. Alerts, filings and press releases land on a phone
 * over a rising chart. Notifications come from the live feed; the pick card never names a ticker.
 */
export function PhoneVisual({ items = [], className = "" }: { items?: FeedItem[]; className?: string }) {
  const notes = useMemo(() => buildNotes(items), [items]);
  const [n, setN] = useState(3);
  const [clock, setClock] = useState("9:24");
  const [session, setSession] = useState("Pre-market");
  const { d, area, end } = useMemo(() => linePath(600, 400), []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setN((x) => x + 1), 2800);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const fmt = () => {
      const t = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone: "America/New_York" });
      const [hh, mm] = t.split(":").map(Number);
      const m = hh * 60 + mm;
      setClock(`${hh % 12 || 12}:${String(mm).padStart(2, "0")}`);
      setSession(m < 570 ? "Pre-market" : m < 960 ? "Market open" : "After hours");
    };
    fmt();
    const id = setInterval(fmt, 15_000);
    return () => clearInterval(id);
  }, []);

  // Newest on top, 4 visible.
  const visible = Array.from({ length: Math.min(4, notes.length) }, (_, i) => {
    const k = n - i;
    return { note: notes[((k % notes.length) + notes.length) % notes.length], key: k, i };
  });

  return (
    <div className={`relative h-full w-full ${className}`} aria-hidden="true">
      <svg viewBox="0 0 600 400" preserveAspectRatio="none" className="absolute inset-x-0 bottom-[6%] h-[70%] w-full [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
        <defs>
          <linearGradient id="pv-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#12e27a" stopOpacity="0.22" />
            <stop offset="1" stopColor="#12e27a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="600" y1={400 * g} y2={400 * g} stroke="rgba(255,255,255,0.05)" vectorEffect="non-scaling-stroke" />)}
        <path d={area} fill="url(#pv-fill)" />
        <path d={d} fill="none" stroke="#12e27a" strokeWidth="2" vectorEffect="non-scaling-stroke" className="pv-draw" />
        <circle cx={end[0] - 2} cy={end[1]} r="4" fill="#12e27a" className="animate-pulse-dot" />
      </svg>

      <div className="absolute left-1/2 top-1/2 w-[272px] -translate-x-1/2 -translate-y-1/2 sm:w-[300px]">
        <div className="relative rounded-[46px] border border-line-strong bg-[#050708] p-[10px] shadow-[0_40px_120px_-30px_rgba(18,226,122,0.35),0_30px_80px_-20px_rgba(0,0,0,0.9)]">
          <div className="relative h-[520px] overflow-hidden rounded-[37px] bg-[radial-gradient(120%_70%_at_50%_0%,#0d1f16_0%,#07090a_60%)] sm:h-[560px]">
            <div className="absolute left-1/2 top-3 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
            <div className="pt-16 text-center">
              <p className="text-[13px] font-medium text-muted">{session} · ET</p>
              <p className="num mt-0.5 text-[58px] font-semibold leading-none tracking-tight text-ink/95">{clock}</p>
            </div>
            <ul className="absolute inset-x-3 top-[178px] space-y-2">
              {visible.map(({ note, key, i }) => (
                <li key={key} className="pv-note" style={{ opacity: 1 - i * 0.18, transform: `scale(${1 - i * 0.025})` }}>
                  <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.06] p-3 backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-[11px] text-muted">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand">
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#04130b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m4 16 5-5 4 4 7-7" /></svg>
                      </span>
                      <span className="font-semibold uppercase tracking-wider">BigStocks</span>
                      <span className={`whitespace-nowrap rounded px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider ${note.kind === "alert" ? "bg-brand/20 text-brand" : note.kind === "filing" ? "bg-[#7fb8ff]/15 text-[#7fb8ff]" : "bg-white/10 text-ink/80"}`}>
                        {note.kind === "alert" ? "Alert" : note.kind === "filing" ? "Filing" : "News"}
                      </span>
                      <span className="ml-auto whitespace-nowrap">{i === 0 ? "now" : `${i * 2}m ago`}</span>
                    </div>
                    <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-ink">{note.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{note.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
