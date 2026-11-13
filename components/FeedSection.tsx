"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedResponse } from "@/lib/feeds/types";
import { feedQuery } from "@/lib/feeds/queries";
import { resolveCompanyTicker } from "@/lib/search/companies";
import { companyDirectoryQuery } from "@/lib/search/queries";
import { links } from "@/lib/site";
import { SOURCE_CREDITS } from "@/lib/feeds/sources";
import { SmartLink } from "./SmartLink";
import { FeedRow } from "./FeedRow";
import { BellButton } from "./BellButton";
import { ArrowRight } from "./Icons";
import { CompanySearch } from "./CompanySearch";

type Tab = "all" | "press" | "filing";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "press", label: "Press releases" },
  { id: "filing", label: "SEC filings" },
];

export function FeedSection({ initial }: { initial: FeedResponse }) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<{ ticker?: string; q?: string }>({});
  const [keywordOnly, setKeywordOnly] = useState(false);
  const client = useQueryClient();
  const directory = useQuery({ ...companyDirectoryQuery, enabled: false });

  useEffect(() => {
    const id = setTimeout(() => {
      const ticker = keywordOnly ? null : resolveCompanyTicker(query, directory.data);
      setFilter(ticker ? { ticker } : query.trim() ? { q: query.trim() } : {});
    }, query.trim() ? 350 : 0);
    return () => clearTimeout(id);
  }, [query, directory.data, keywordOnly]);

  const feed = useQuery({
    ...feedQuery({ kind: tab, ...filter, limit: 8 }),
    initialData: tab === "all" && !filter.ticker && !filter.q ? initial : undefined,
  });
  const data = feed.data;
  const ticker = filter.ticker;
  const searchTerm = ticker ?? filter.q;

  function apply(text: string, keywords = false) {
    setQuery(text);
    setKeywordOnly(keywords);
    const ticker = keywords ? null : resolveCompanyTicker(text, client.getQueryData(companyDirectoryQuery.queryKey));
    setFilter(ticker ? { ticker } : text.trim() ? { q: text.trim() } : {});
  }

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
            Search a ticker, company or headline. Choose a company, then hit the bell to get its news by email or text.
          </p>

          {/* Search form for ticker input */}
          <div className="mt-8 max-w-md">
            <CompanySearch value={query} onChange={(text) => { setQuery(text); setKeywordOnly(false); }}
              onSelect={(company) => apply(company.ticker)} onSubmit={apply} onClear={() => apply("")}
              placeholder="Ticker, company or headline"
              className="!h-16 !border-brand/40 shadow-[0_0_0_4px_rgba(18,226,122,0.06)]" />
          </div>

          {ticker && (
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
                {data?.mode === "sample" ? "Sample data (dev preview)" : "Live"}
              </span>
              <BellButton ticker={ticker} source="home-feed-bell"
                label={ticker ? undefined : "Alert me"} className="!h-9" />
            </div>
          </div>

          {feed.isError && <p role="alert" className="border-b border-line px-6 py-4 text-[14px] text-muted">
            Could not load the feed. <button type="button" onClick={() => void feed.refetch()} className="text-brand underline">Retry</button>
          </p>}
          {feed.isPending ? (
            <ul aria-busy="true" className="divide-y divide-line">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="grid grid-cols-[auto_1fr] gap-4 px-6 py-5">
                  <span className="skeleton h-7 w-16" />
                  <span className="space-y-2"><span className="skeleton block h-4 w-4/5" /><span className="skeleton block h-3 w-1/3" /></span>
                </li>
              ))}
            </ul>
          ) : data?.items.length ? (
            <ul className="divide-y divide-line">{data.items.map((it) => <FeedRow key={it.id} item={it} />)}</ul>
          ) : !feed.isError && (
            <div className="px-6 py-16 text-center">
              <p className="font-medium">{searchTerm ? `Nothing found for ${searchTerm} yet.` : "The feed is warming up."}</p>
              <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
                {searchTerm ? "Try another company, headline or feed tab." : "New press releases and filings appear here within minutes of hitting the wire."}
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
