"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWatchlist } from "./useWatchlist";

type Item = { ticker: string; title: string; form: string; accepted: string; dateOnly: boolean; importance: string };

function when(iso: string, dateOnly: boolean) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  if (dateOnly) return sameDay ? "Today" : day;
  return sameDay ? `Today ${time} ET` : `${day}, ${time} ET`;
}

export default function LatestNews() {
  const { list } = useWatchlist();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    if (!list) return;
    if (!list.length) return setItems([]);
    fetch(`/api/filings?symbols=${list.join(",")}`)
      .then((r) => r.json())
      .then(setItems)
      .catch(() => setItems([]));
  }, [list]);

  return (
    <section className="panel">
      <header>
        <h2>Latest from your stocks</h2>
        <span className="small muted">Official company announcements</span>
      </header>
      {items === null && <div className="empty">Loading announcements…</div>}
      {items?.length === 0 && <div className="empty">No recent announcements for your watchlist.</div>}
      <div className="rows">
        {items?.map((n, i) => (
          <Link key={i} href={`/stock/${n.ticker}?tab=filings`} className="row news-row">
            <span className="meta">
              <span className="tick">{n.ticker}</span>
              <span>{when(n.accepted, n.dateOnly)}</span>
              <span className={`imp ${n.importance}`}>{n.importance}</span>
            </span>
            <strong>{n.title}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}
