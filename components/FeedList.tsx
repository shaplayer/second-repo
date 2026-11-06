"use client";
import { useEffect, useRef, useState } from "react";
import type { FeedItem, FeedKind, FeedResponse } from "@/lib/feeds/types";
import { FeedRow } from "./FeedRow";

export type FeedFilter = { kind?: FeedKind | "all"; ticker?: string; forms?: string[]; q?: string };

const PAGE = 25;

function dayLabel(iso: string, now: Date) {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(iso);
  if (fmt(d) === fmt(now)) return "Today";
  if (fmt(d) === fmt(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });
}

function query(f: FeedFilter, before?: string | null) {
  const p = new URLSearchParams({ limit: String(PAGE), kind: f.kind ?? "all" });
  if (f.ticker) p.set("ticker", f.ticker);
  if (f.forms?.length) p.set("forms", f.forms.join(","));
  if (f.q) p.set("q", f.q);
  if (before) p.set("before", before);
  return `/api/feed?${p}`;
}

/** Paged feed grouped by day (US Eastern). `initial` is server-rendered for the same filter. */
export function FeedList({ initial, filter, showTicker = true, empty }: {
  initial: FeedResponse; filter: FeedFilter; showTicker?: boolean; empty?: React.ReactNode;
}) {
  const [items, setItems] = useState<FeedItem[]>(initial.items);
  const [next, setNext] = useState<string | null>(initial.nextBefore);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const key = JSON.stringify(filter);
  const firstKey = useRef(key);

  useEffect(() => setNow(new Date()), []);

  // Filter changed on the client: reload page 1.
  useEffect(() => {
    if (key === firstKey.current) return;
    firstKey.current = key;
    const ctrl = new AbortController();
    setLoading(true);
    fetch(query(filter), { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: FeedResponse) => { setItems(d.items); setNext(d.nextBefore); })
      .catch(() => {})
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function more() {
    if (!next) return;
    setLoading(true);
    try {
      const d: FeedResponse = await (await fetch(query(filter, next))).json();
      setItems((cur) => {
        const seen = new Set(cur.map((i) => i.id));
        return [...cur, ...d.items.filter((i) => !seen.has(i.id))];
      });
      setNext(d.nextBefore);
    } finally { setLoading(false); }
  }

  if (!items.length && !loading) {
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
      {next && !loading && (
        <div className="border-t border-line p-4 text-center">
          <button type="button" onClick={more} className="btn-ghost">Load more</button>
        </div>
      )}
    </div>
  );
}
