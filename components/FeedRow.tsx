import Link from "next/link";
import type { FeedItem } from "@/lib/feeds/types";
import { FORM_LABELS } from "@/lib/feeds/sources";
import { TimeAgo } from "./TimeAgo";
import { ArrowUpRight, Doc, Megaphone } from "./Icons";

/** One feed row. Ticker chip opens our ticker page; the headline opens the source. */
export function FeedRow({ item, showTicker = true }: { item: FeedItem; showTicker?: boolean }) {
  const isFiling = item.kind === "filing";
  const formHint = isFiling && item.formType ? FORM_LABELS[item.formType] ?? FORM_LABELS[item.formType.split("/")[0]] : undefined;
  return (
    <li className={`group relative grid items-start gap-4 px-5 py-4 transition-colors hover:bg-white/[0.025] sm:px-6 ${showTicker ? "grid-cols-[auto_1fr_auto]" : "grid-cols-[1fr_auto]"}`}>
      {showTicker && (
        item.ticker ? (
          <Link href={`/news/${encodeURIComponent(item.ticker)}`} title={`All ${item.ticker} news & filings`}
            className="num relative z-10 mt-0.5 inline-flex h-7 min-w-[64px] items-center justify-center rounded-lg border border-line-strong bg-bg px-2 font-mono text-[12.5px] font-semibold tracking-wide text-ink transition-colors hover:border-brand/60 hover:text-brand">
            {item.ticker}
          </Link>
        ) : <span className="mt-0.5 inline-flex h-7 min-w-[64px] items-center justify-center rounded-lg border border-line bg-bg text-faint">-</span>
      )}
      <span className="min-w-0">
        {/* Stretched link: the whole row opens the source, except the ticker chip. */}
        <a href={item.url} target="_blank" rel="noopener noreferrer"
          className="line-clamp-2 text-[15px] leading-snug text-ink transition-colors after:absolute after:inset-0 group-hover:text-white">
          {item.title}
        </a>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-faint">
          <span className={`inline-flex items-center gap-1 ${isFiling ? "text-[#7fb8ff]" : "text-brand"}`} title={formHint}>
            {isFiling ? <Doc className="h-3.5 w-3.5" /> : <Megaphone className="h-3.5 w-3.5" />}
            {isFiling ? item.formType : "Press release"}
          </span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">{item.source}</span>
          <span aria-hidden="true">·</span>
          <TimeAgo iso={item.publishedAt} />
        </span>
      </span>
      <ArrowUpRight className="mt-1 h-4 w-4 text-faint transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand" />
    </li>
  );
}
