"use client";
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { FeedItem, FeedResponse } from "@/lib/feeds/types";
import { feedPagesQuery, type FeedFilter } from "@/lib/feeds/queries";
import { FeedRow } from "./FeedRow";

export type { FeedFilter } from "@/lib/feeds/queries";

function dayLabel(iso: string, now: Date) {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(iso);
  if (fmt(d) === fmt(now)) return "Today";
  if (fmt(d) === fmt(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });
}

/** Paged feed grouped by day (US Eastern). `initial` is server-rendered for the same filter. */
export function FeedList({ initial, filter, showTicker = true, empty }: {
  initial: FeedResponse; filter: FeedFilter; showTicker?: boolean; empty?: React.ReactNode;
}) {
  const feed = useInfiniteQuery({
    ...feedPagesQuery(filter),
    initialData: { pages: [initial], pageParams: [null] },
  });
  const seen = new Set<string>();
  const items = feed.data.pages.flatMap((page) => page.items).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const loading = feed.isFetchingNextPage;
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => setNow(new Date()), []);

  if (!items.length && !loading && !feed.isError) {
    return <div className="px-6 py-16 text-center">{empty ?? <p className="text-muted">Nothing here yet.</p>}</div>;
  }

  // Group by day.
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const it of items) {
    const label = now ? dayLabel(it.publishedAt, now) : it.publishedAt.slice(0, 10);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(it); else groups.push({ label, items: [it] });
  }

  return (
    <div aria-busy={loading}>
      {feed.isError && <p role="alert" className="border-b border-line px-6 py-4 text-[14px] text-muted">
        Could not load {feed.isFetchNextPageError ? "more items" : "the feed"}.{" "}
        <button type="button" onClick={() => void (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch())}
          className="text-brand underline">Retry</button>
      </p>}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="sticky top-[68px] z-20 border-b border-line bg-surface/95 px-5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-faint backdrop-blur sm:px-6" suppressHydrationWarning>
            {g.label}
          </h3>
          <ul className="divide-y divide-line">{g.items.map((it) => <FeedRow key={it.id} item={it} showTicker={showTicker} />)}</ul>
        </section>
      ))}
      {loading && (
        <ul className="divide-y divide-line border-t border-line">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr] gap-4 px-6 py-5">
              <span className="skeleton h-7 w-16" />
              <span className="space-y-2"><span className="skeleton block h-4 w-4/5" /><span className="skeleton block h-3 w-1/3" /></span>
            </li>
          ))}
        </ul>
      )}
      {feed.hasNextPage && !loading && !feed.isError && (
        <div className="border-t border-line p-4 text-center">
          <button type="button" onClick={() => void feed.fetchNextPage()} className="btn-ghost">Load more</button>
        </div>
      )}
    </div>
  );
}
