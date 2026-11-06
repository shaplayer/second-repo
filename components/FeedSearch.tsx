"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "./Icons";

/**
 * One box for tickers and keywords: "AAPL" or "$AAPL" opens the ticker page,
 * anything else searches headlines on the given page.
 */
export function FeedSearch({ base = "/news", defaultValue = "", autoFocus = false }: { base?: string; defaultValue?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(defaultValue);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const s = v.trim();
    if (!s) return router.push(base);
    const t = s.replace(/^\$/, "");
    // "$XYZ" or one short word ("AAPL", "tsla", "BRK.B") opens the ticker page; anything else searches headlines.
    if (s.startsWith("$") || /^[A-Za-z]{1,5}(\.[A-Za-z])?$/.test(t)) {
      router.push(`/news/${encodeURIComponent(t.toUpperCase())}`);
    } else {
      router.push(`${base}?q=${encodeURIComponent(s)}`);
    }
  }

  return (
    <form role="search" onSubmit={go} className="flex h-12 w-full items-center gap-3 rounded-full border border-line-strong bg-surface pl-4 pr-1.5 focus-within:border-brand/60">
      <Search className="h-4 w-4 shrink-0 text-faint" />
      <label htmlFor="feed-search" className="sr-only">Search ticker or keyword</label>
      <input id="feed-search" value={v} onChange={(e) => setV(e.target.value.slice(0, 80))} autoFocus={autoFocus}
        placeholder="Ticker (AAPL) or keyword (earnings, FDA, merger…)" autoComplete="off" spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink placeholder:text-faint focus:outline-none" />
      <button type="submit" className="btn-primary !h-9 !px-4 !text-[13.5px]">Search</button>
    </form>
  );
}
