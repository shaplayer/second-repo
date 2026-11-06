"use client";
import { useEffect, useState } from "react";
import { msUntilNextAlert } from "@/lib/schedule";

function split(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
const pad = (n: number) => String(n).padStart(2, "0");

export function useCountdown() {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setMs(msUntilNextAlert());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return ms;
}

/** "02:14:33" inline (hours include days). */
export function CountdownInline({ className = "" }: { className?: string }) {
  const ms = useCountdown();
  if (ms == null) return <span className={`num ${className}`}>--:--:--</span>;
  const t = split(ms);
  return <span className={`num ${className}`}>{pad(t.d * 24 + t.h)}:{pad(t.m)}:{pad(t.s)}</span>;
}

/** Large segmented countdown for the alert band. */
export function CountdownBlocks() {
  const ms = useCountdown();
  const t = ms == null ? null : split(ms);
  const parts: [string, number | null][] = [
    ["Hours", t ? t.d * 24 + t.h : null],
    ["Min", t ? t.m : null],
    ["Sec", t ? t.s : null],
  ];
  return (
    <div className="flex items-start gap-2 sm:gap-3" role="timer" aria-live="off">
      {parts.map(([label, v], i) => (
        <div key={label} className="flex items-start gap-2 sm:gap-3">
          <div className="flex flex-col items-center">
            <span className="num min-w-[2.6ch] rounded-xl border border-line-strong bg-bg/60 px-2.5 py-2 text-center text-[28px] font-semibold leading-none tracking-tight sm:text-[34px]">
              {v == null ? "--" : pad(v)}
            </span>
            <span className="mt-2 text-[11px] uppercase tracking-[0.14em] text-faint">{label}</span>
          </div>
          {i < 2 && <span className="pt-2 text-[24px] text-faint">:</span>}
        </div>
      ))}
    </div>
  );
}
