"use client";

import { useEffect, useState } from "react";
import { ago, clockET } from "@/lib/time";

/** A relative time that keeps itself up to date. `suffix` adds " ago" for the short forms. */
export function TimeAgo({ iso, suffix = false, className }: { iso: string; suffix?: boolean; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  // Until the browser takes over, show the clock time: it is the same on the server and in the browser.
  const text = now === null ? clockET(iso) : ago(iso, now);
  const short = now !== null && /\d (s|m|h)$/.test(text);
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })} className={className} suppressHydrationWarning>
      {text}{suffix && short ? " ago" : ""}
    </time>
  );
}
