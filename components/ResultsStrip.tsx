import type { AlertResult } from "@/lib/alerts";
import { formatET } from "@/lib/format";
import { RESULT_META } from "./ResultBadge";

type Item = { id: string; ticker: string; alertedAt: string; result: AlertResult };

const FILL: Record<AlertResult, string> = {
  win: "bg-brand",
  loss: "bg-down",
  flat: "bg-faint",
  open: "border border-line-strong bg-transparent",
};

/** One cell per alert, oldest -> newest, so streaks and misses are visible at a glance. */
export function ResultsStrip({ items }: { items: Item[] }) {
  if (!items.length) return null;
  return (
    <figure className="card p-6 md:p-7">
      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[14px] font-medium">Last {items.length} alerts, oldest to newest</span>
        <span className="flex flex-wrap gap-4 text-[12.5px] text-muted" aria-label="Legend">
          {(["win", "loss", "flat", "open"] as AlertResult[]).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-[3px] ${FILL[r]}`} aria-hidden="true" />{RESULT_META[r].label}
            </span>
          ))}
        </span>
      </figcaption>
      <ol className="mt-5 flex flex-wrap gap-[3px]" aria-label="Alert results in order">
        {items.map((a) => (
          <li key={a.id}>
            <a href={`#alert-${a.id}`} title={`${a.ticker} · ${formatET(a.alertedAt)} · ${RESULT_META[a.result].label}`}
              className={`block h-6 w-3.5 rounded-[4px] transition-transform hover:scale-y-110 sm:w-4 ${FILL[a.result]}`}>
              <span className="sr-only">{a.ticker} {formatET(a.alertedAt)}: {RESULT_META[a.result].label}</span>
            </a>
          </li>
        ))}
      </ol>
    </figure>
  );
}
