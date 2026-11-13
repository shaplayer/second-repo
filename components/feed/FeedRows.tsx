import Link from "next/link";
import { TypeText } from "@/components/ui/Badges";
import { TimeAgo } from "@/components/ui/TimeAgo";
import type { FeedItem } from "@/lib/data/feed";

/** A plain list of posts: ticker, kind, headline, time. Each row opens the item's own page. */
export function FeedRows({ items, hideTicker = false, className = "" }: { items: FeedItem[]; hideTicker?: boolean; className?: string }) {
  return (
    <div className={className}>
      {items.map((it) => (
        <Link key={it.id} href={it.path} className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 border-t border-line-soft py-[15px] text-ink no-underline hover:text-ink">
          {!hideTicker && <span className="w-16 flex-none truncate font-extrabold">{it.ticker ? `$${it.ticker}` : it.company}</span>}
          <TypeText category={it.category} label={it.typeLabel} className="w-[140px] flex-none !text-xs" />
          <span className="min-w-0 flex-[1_1_300px] text-[15px] leading-[1.45]">{it.headline}</span>
          <TimeAgo iso={it.publishedAt} className="text-[13px] text-muted" />
        </Link>
      ))}
    </div>
  );
}
