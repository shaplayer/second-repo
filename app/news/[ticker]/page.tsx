import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeed } from "@/lib/feeds";
import { normalizeTicker, tickerMap } from "@/lib/feeds/tickers";
import { tidyName } from "@/lib/feeds/edgar";
import { FeedList } from "@/components/FeedList";
import { NewsShell, SectionTabs } from "@/components/NewsShell";
import { CopyLink } from "@/components/CopyLink";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ticker: string }>; searchParams: Promise<{ type?: string }> };

async function companyName(ticker: string): Promise<string | null> {
  try {
    const hit = (await tickerMap()).byTicker.get(ticker);
    return hit ? tidyName(hit.name) : null;
  } catch { return null; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = normalizeTicker(decodeURIComponent((await params).ticker));
  if (!t) return {};
  const name = await companyName(t);
  return {
    title: `${t}${name ? ` (${name})` : ""} News, Press Releases & SEC Filings | BigStocks`,
    description: `The latest ${name ?? t} press releases and SEC filings in one place, updated within minutes.`,
  };
}

export default async function TickerPage({ params, searchParams }: Props) {
  const raw = decodeURIComponent((await params).ticker);
  const ticker = normalizeTicker(raw);
  if (!ticker) notFound();
  const { type } = await searchParams;
  const kind = type === "press" || type === "filing" ? type : "all";

  const [initial, secName] = await Promise.all([getFeed({ ticker, kind, limit: 25 }), companyName(ticker)]);
  const name = secName ?? initial.items.find((i) => i.company)?.company ?? null;

  const tab = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors ${on ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink"}`;
  const href = (t?: string) => (t ? `/news/${ticker}?type=${t}` : `/news/${ticker}`);

  return (
    <NewsShell
      searchBase="/news"
      header={
        <>
          <SectionTabs active={null} />
          <div className="mt-6 flex flex-wrap items-end gap-x-5 gap-y-3">
            <h1 className="font-mono text-[42px] font-semibold leading-none tracking-tight md:text-[56px]">${ticker}</h1>
            {name && <p className="pb-1 text-[18px] text-muted md:text-[20px]">{name}</p>}
          </div>
          <p className="mt-4 max-w-xl text-[16px] text-muted">
            Every {name ?? ticker} press release and SEC filing, in one place.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <CopyLink className="btn-ghost !h-9 !text-[13px]" />
            <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(ticker)}&type=&dateb=&owner=include&count=40`}
              target="_blank" rel="noopener noreferrer" className="btn-ghost !h-9 !text-[13px]">View on SEC EDGAR ↗</a>
          </div>
        </>
      }
      toolbar={
        <nav aria-label="Type" className="inline-flex rounded-full border border-line bg-surface p-1">
          <Link href={href()} className={tab(kind === "all")} aria-current={kind === "all" ? "page" : undefined}>All</Link>
          <Link href={href("press")} className={tab(kind === "press")} aria-current={kind === "press" ? "page" : undefined}>Press releases</Link>
          <Link href={href("filing")} className={tab(kind === "filing")} aria-current={kind === "filing" ? "page" : undefined}>SEC filings</Link>
        </nav>
      }
      sidebarTop={
        <div className="card p-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">Is this your company?</p>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Share this page with investors: <span className="font-mono text-ink">bigstocks.com/news/{ticker}</span>. Every new release and filing shows up here automatically.
          </p>
        </div>
      }
    >
      <FeedList
        initial={initial}
        filter={{ ticker, kind }}
        showTicker={false}
        empty={
          <>
            <p className="font-medium">Nothing found for {ticker} yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
              Check the symbol, or{" "}
              <Link href={`/news?q=${encodeURIComponent(raw)}`} className="text-brand hover:underline">search &ldquo;{raw}&rdquo; in headlines</Link>.
            </p>
          </>
        }
      />
    </NewsShell>
  );
}
