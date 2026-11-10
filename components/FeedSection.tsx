"use client";
import { useEffect, useRef, useState } from "react";
import type { FeedResponse } from "@/lib/feeds/types";
import { links } from "@/lib/site";
import { SOURCE_CREDITS } from "@/lib/feeds/sources";
import { SmartLink } from "./SmartLink";
import { FeedRow } from "./FeedRow";
import { BellButton } from "./BellButton";
import { ArrowRight, Search } from "./Icons";

type Tab = "all" | "press" | "filing";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "press", label: "Press releases" },
  { id: "filing", label: "SEC filings" },
];

export function FeedSection({ initial }: { initial: FeedResponse }) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<FeedResponse>(initial);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const ticker = query.trim().toUpperCase().replace(/^\$/, "");
  const validTicker = /^[A-Z]{1,5}(\.[A-Z])?$/.test(ticker);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ kind: tab, limit: "8" });
        if (ticker) p.set("ticker", ticker);
        const res = await fetch(`/api/feed?${p}`, { signal: ctrl.signal });
        if (res.ok) setData(await res.json());
      } catch { /* aborted or offline: keep current list */ }
      finally { if (!ctrl.signal.aborted) setLoading(false); }
    }, ticker ? 350 : 0);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [tab, ticker]);

  return (
    <section id="news" className="container-wide py-20 md:py-24" aria-labelledby="feed-title">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="eyebrow"><span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" /> Live news &amp; filings</p>
          <h2 id="feed-title" className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-tight md:text-[40px]">
            See it the second it posts. <span className="text-muted">Then get it sent to you.</span>
          </h2>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-muted">
            Every press release and SEC filing in one place, straight from the newswires and SEC EDGAR.
            Type a ticker, then hit the bell to get that company&apos;s news by email or text.
          </p>

          <form role="search" onSubmit={(e) => e.preventDefault()}
            className="mt-8 flex h-16 max-w-md items-center gap-3 rounded-full border border-brand/40 bg-surface px-5 shadow-[0_0_0_4px_rgba(18,226,122,0.06)] focus-within:border-brand/70">
            <Search className="h-5 w-5 text-brand" />
            <label htmlFor="ticker-search" className="sr-only">Search by ticker</label>
            <input id="ticker-search" value={query} onChange={(e) => setQuery(e.target.value.slice(0, 10))}
              placeholder="Type a ticker, e.g. AAPL" autoComplete="off" spellCheck={false}
              className="num min-w-0 flex-1 bg-transparent font-mono text-[17px] uppercase text-ink placeholder:font-sans placeholder:normal-case placeholder:text-faint focus:outline-none" />
            {query && <button type="button" onClick={() => setQuery("")} className="text-[12px] text-faint hover:text-ink">Clear</button>}
          </form>

          {validTicker && (
            <>
              <SmartLink href={`/news/${ticker}`} className="mt-3 inline-flex items-center gap-1.5 pl-4 text-[13.5px] text-brand hover:underline">
                Open the full ${ticker} page <ArrowRight className="h-3.5 w-3.5" />
              </SmartLink>
              <div className="mt-5"><BellButton key={ticker} ticker={ticker} source="home-search-bell" /></div>
            </>
          )}

          <div className="mt-8 hidden gap-3 text-[13px] lg:flex">
            <SmartLink href={links.news} className="btn-ghost">All news <ArrowRight /></SmartLink>
            <SmartLink href={links.filings} className="btn-ghost">All filings <ArrowRight /></SmartLink>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
            <div role="tablist" aria-label="Feed type" className="flex gap-1">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                  className={`rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors ${tab === t.id ? "bg-white/[0.07] text-ink" : "text-muted hover:text-ink"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden items-center gap-2 text-[12px] text-faint sm:inline-flex">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" />
                {data.mode === "sample" ? "Sample data (dev preview)" : "Live"}
              </span>
              <BellButton ticker={validTicker ? ticker : undefined} source="home-feed-bell"
                label={validTicker ? undefined : "Alert me"} className="!h-9" />
            </div>
          </div>

          {loading ? (
            <ul aria-busy="true" className="divide-y divide-line">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="grid grid-cols-[auto_1fr] gap-4 px-6 py-5">
                  <span className="skeleton h-7 w-16" />
                  <span className="space-y-2"><span className="skeleton block h-4 w-4/5" /><span className="skeleton block h-3 w-1/3" /></span>
                </li>
              ))}
            </ul>
          ) : data.items.length ? (
            <ul className="divide-y divide-line">{data.items.map((it) => <FeedRow key={it.id} item={it} />)}</ul>
          ) : (
            <div className="px-6 py-16 text-center">
              <p className="font-medium">{ticker ? `Nothing found for ${ticker} yet.` : "The feed is warming up."}</p>
              <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
                {ticker ? "Check the symbol, or try the SEC filings tab." : "New press releases and filings appear here within minutes of hitting the wire."}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-[12px] text-faint sm:px-6">
            <span>Sources: {SOURCE_CREDITS}</span>
            <span className="flex gap-4 lg:hidden">
              <SmartLink href={links.news} className="text-brand">All news →</SmartLink>
              <SmartLink href={links.filings} className="text-brand">All filings →</SmartLink>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
