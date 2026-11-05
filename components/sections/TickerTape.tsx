import type { FeedItem } from "@/lib/feeds/types";
import { links } from "@/lib/site";

/** Scrolling strip of the latest tickers in the news (real feed data only). */
export function TickerTape({ items }: { items: FeedItem[] }) {
  const unique = items.filter((it, i, a) => it.ticker && a.findIndex((x) => x.ticker === it.ticker) === i).slice(0, 16);
  if (unique.length < 3) return null;
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-8 pr-8" aria-hidden={hidden || undefined}>
      {unique.map((it) => (
        <li key={`${hidden}-${it.id}`} className="flex items-center gap-2 whitespace-nowrap text-[12.5px]">
          <span className="font-mono font-semibold text-ink">${it.ticker}</span>
          <span className={`rounded-md px-1.5 py-px text-[10.5px] font-semibold ${it.kind === "filing" ? "bg-[#7fb8ff]/10 text-[#7fb8ff]" : "bg-brand/10 text-brand"}`}>
            {it.kind === "filing" ? it.formType : "PR"}
          </span>
          <span className="max-w-[280px] truncate text-muted">{it.title}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <a href={links.news} className="group block border-b border-line bg-surface/50" aria-label="Latest tickers in the news">
      <div className="relative flex overflow-hidden py-2.5 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]">
        <div className="flex animate-marquee group-hover:[animation-play-state:paused]">{row(false)}{row(true)}</div>
      </div>
    </a>
  );
}
