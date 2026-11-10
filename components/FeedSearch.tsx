"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Search } from "./Icons";

/**
 * One box for tickers and keywords: "AAPL" or "$AAPL" opens the ticker page,
 * anything else searches headlines on the given page.
 * size="lg": news pages. size="sm": the small search bubble in the hero and top menu.
 */
export function FeedSearch({ base = "/news", defaultValue = "", autoFocus = false, size = "lg", placeholder, onDone }: {
  base?: string; defaultValue?: string; autoFocus?: boolean; size?: "lg" | "sm"; placeholder?: string; onDone?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [v, setV] = useState(defaultValue);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const s = v.trim();
    onDone?.();
    if (!s) return router.push(base);
    const t = s.replace(/^\$/, "");
    // "$XYZ" or one short word ("AAPL", "tsla", "BRK.B") opens the ticker page; anything else searches headlines.
    if (s.startsWith("$") || /^[A-Za-z]{1,5}(\.[A-Za-z])?$/.test(t)) {
      router.push(`/news/${encodeURIComponent(t.toUpperCase())}`);
    } else {
      router.push(`${base}?q=${encodeURIComponent(s)}`);
    }
  }

  const sm = size === "sm";
  return (
    <form role="search" onSubmit={go}
      className={`flex w-full items-center rounded-full border border-line-strong focus-within:border-brand/60 ${sm ? "h-11 gap-2.5 bg-surface/90 pl-4 pr-1.5 backdrop-blur-md" : "h-14 gap-3 bg-surface pl-5 pr-1.5"}`}>
      <Search className={`shrink-0 text-faint ${sm ? "h-4 w-4" : "h-5 w-5"}`} />
      <label htmlFor={id} className="sr-only">Search ticker or keyword</label>
      <input id={id} value={v} onChange={(e) => setV(e.target.value.slice(0, 80))} autoFocus={autoFocus}
        placeholder={placeholder ?? "Ticker (AAPL) or keyword (earnings, FDA, merger…)"} autoComplete="off" spellCheck={false}
        className={`min-w-0 flex-1 bg-transparent text-ink placeholder:text-faint focus:outline-none ${sm ? "text-[14px]" : "text-[16px]"}`} />
      <button type="submit" className={`btn-primary ${sm ? "!h-8 !px-3.5 !text-[13px]" : "!h-11 !px-5 !text-[14.5px]"}`}>{sm ? "Go" : "Search"}</button>
    </form>
  );
}
