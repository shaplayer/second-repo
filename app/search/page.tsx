import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeedRows } from "@/components/feed/FeedRows";
import { Shell } from "@/components/site/Shell";
import { HealthPill, Initials } from "@/components/ui/Badges";
import { SearchIcon } from "@/components/ui/Icons";
import { searchCompanies } from "@/lib/data/companies";
import { getFeed, type FeedItem } from "@/lib/data/feed";
import { db } from "@/lib/db";
import { normalizeTicker } from "@/lib/sec/companies";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 60);
  const pool = db();
  const companies = q ? await searchCompanies(pool, q, 8).catch(() => []) : [];
  // Typing an exact ticker goes straight to its page.
  const exact = normalizeTicker(q);
  if (exact && companies[0]?.ticker === exact) redirect(`/stock/${encodeURIComponent(exact)}`);
  const news = q.length >= 2 ? await getFeed(pool, { text: q, limit: 20 }).then((p) => p.items).catch(() => [] as FeedItem[]) : [];
  const latest = new Map<number, FeedItem | undefined>();
  for (const c of companies.slice(0, 5)) latest.set(c.cik, (await getFeed(pool, { cik: c.cik, limit: 1 }).catch(() => ({ items: [] as FeedItem[] }))).items[0]);

  return (
    <Shell search={false}>
      <section className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-4 pb-4 pt-8 md:px-8">
        <form role="search" action="/search" className="flex gap-2 rounded-[22px] bg-white p-2 shadow-[0_16px_40px_rgba(12,60,35,0.12),0_0_0_1px_#dfe9e3]">
          <label htmlFor="sr-q" className="sr-only">Search</label>
          <span aria-hidden="true" className="flex items-center pl-3 text-ink-2"><SearchIcon className="h-5 w-5" /></span>
          <input id="sr-q" name="q" type="search" defaultValue={q} placeholder="Ticker or company" autoComplete="off"
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-xl font-bold outline-none" />
          <button type="submit" className="btn btn-brand h-14 rounded-2xl px-6 text-base font-extrabold">Search</button>
        </form>
        {q && (
          <span className="text-sm text-muted">
            {companies.length} {companies.length === 1 ? "company" : "companies"} and {news.length}{news.length === 20 ? "+" : ""} news {news.length === 1 ? "item" : "items"} match “{q}”
          </span>
        )}
      </section>

      {companies.length > 0 && (
        <section aria-labelledby="sr-co" className="mx-auto w-full max-w-[900px] px-4 pb-6 md:px-8">
          <h2 id="sr-co" className="m-0 mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-muted">COMPANIES</h2>
          <div className="flex flex-col gap-2.5">
            {companies.map((c) => (
              <Link key={c.cik} href={`/stock/${encodeURIComponent(c.ticker!)}`}
                className="card flex flex-wrap items-center gap-3.5 rounded-[22px] px-[18px] py-4 text-ink no-underline hover:bg-inset hover:text-ink">
                <Initials name={c.name} ticker={c.ticker} size={46} />
                <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                  <strong className="text-[17px]">{c.name} <span className="text-muted">${c.ticker}</span></strong>
                  <span className="text-[13px] text-muted">{[c.exchange, c.industry].filter(Boolean).join(" · ")}</span>
                  {latest.get(c.cik) && <span className="text-sm text-ink-2">Latest: {latest.get(c.cik)!.headline}</span>}
                </span>
                {c.verdict && <HealthPill verdict={c.verdict} />}
                <span className="btn btn-dark">See page</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="sr-news" className="mx-auto w-full max-w-[900px] px-4 pb-12 md:px-8">
        {news.length > 0 && (
          <>
            <h2 id="sr-news" className="m-0 mb-2.5 text-[13px] font-extrabold tracking-[0.08em] text-muted">NEWS AND FILINGS MENTIONING “{q.toUpperCase()}”, NEWEST FIRST</h2>
            <FeedRows items={news} />
          </>
        )}
        {q && companies.length === 0 && news.length === 0 && (
          <p className="m-0 py-6 text-center text-lg font-bold">Nothing matches “{q}”.</p>
        )}
        <div className="card mt-5 rounded-[22px] bg-inset px-5 py-[18px] text-sm text-ink-2">
          Can&apos;t find a company? We cover every company that files with the SEC. Try its full name, or{" "}
          <a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noopener noreferrer" className="font-bold">search EDGAR directly ↗</a>
        </div>
      </section>
    </Shell>
  );
}
