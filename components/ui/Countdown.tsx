"use client";

import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The countdown to the next pick window (8:00 AM New York time on the next trading day). The server
 * works out how long is left; the browser only counts down, so a wrong clock on the visitor's
 * computer cannot show the wrong time.
 */
export function Countdown({ msLeft, size = "lg" }: { msLeft: number; size?: "lg" | "sm" }) {
  const [left, setLeft] = useState(Math.max(0, Math.floor(msLeft / 1000)));
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setLeft(Math.max(0, Math.floor((msLeft - (Date.now() - started)) / 1000))), 1000);
    return () => clearInterval(t);
  }, [msLeft]);
  const units = [
    { v: pad(Math.floor(left / 3600)), l: "HOURS" },
    { v: pad(Math.floor((left % 3600) / 60)), l: "MINUTES" },
    { v: pad(left % 60), l: "SECONDS" },
  ];
  const box = size === "lg" ? "h-[84px] w-[84px] rounded-[22px] text-[42px] md:h-28 md:w-28 md:rounded-[28px] md:text-6xl" : "h-[72px] w-[72px] rounded-[20px] text-4xl";
  return (
    <div role="timer" aria-live="off" aria-label={`${units[0].v} hours ${units[1].v} minutes until the next pick window`} className="flex flex-wrap gap-2 md:gap-3">
      {units.map((u) => (
        <div key={u.l} className="flex flex-col items-center gap-1.5">
          <span className={`num flex items-center justify-center border border-white/15 bg-white/[0.08] font-extrabold tracking-[-0.04em] ${box}`} suppressHydrationWarning>
            {u.v}
          </span>
          <span className="text-[11px] tracking-[0.1em] text-[#b9c6bf] md:text-xs">{u.l}</span>
        </div>
      ))}
    </div>
  );
}
