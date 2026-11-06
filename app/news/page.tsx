import type { Metadata } from "next";
import Link from "next/link";
import { getFeed } from "@/lib/feeds";
import { FeedList } from "@/components/FeedList";
import { NewsShell, SectionTabs } from "@/components/NewsShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Stock News & Press Releases | BigStocks",
  description: "Every public-company press release as it hits the wire. Search by ticker or keyword.",
};

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 80);
  const initial = await getFeed({ kind: "press", q: query, limit: 25 });

  return (
    <NewsShell
      searchBase="/news"
      searchValue={query}
      header={
        <>
          <SectionTabs active="news" />
          <h1 className="mt-6 text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[46px]">
            {query ? <>Press releases matching &ldquo;{query}&rdquo;</> : <>Every press release. <span className="text-muted">As it hits the wire.</span></>}
          </h1>
          <p className="mt-3 max-w-xl text-[16px] text-muted">
            Public-company news from the major newswires, in one place. Click a ticker to see everything for that company.
          </p>
        </>
      }
      toolbar={query ? <Link href="/news" className="btn-ghost !h-9 !text-[13px]">✕ Clear search</Link> : undefined}
    >
      <FeedList
        initial={initial}
        filter={{ kind: "press", q: query || undefined }}
        empty={
          <>
            <p className="font-medium">{query ? `No press releases match "${query}" yet.` : "The feed is warming up."}</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
              {query ? "Try a ticker instead, or a shorter keyword." : "New releases appear here within minutes of hitting the wire."}
            </p>
          </>
        }
      />
    </NewsShell>
  );
}
