import type { AlertRow } from "@/lib/alerts";

/** Ticker cell for the track record: hides premium picks until the close, and labels them after. */
export function TickerCell({ a, link = true }: { a: AlertRow; link?: boolean }) {
  if (a.hidden) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="rounded bg-brand/15 px-1.5 py-px font-sans text-[10.5px] font-semibold uppercase tracking-wider text-brand">Premium pick</span>
        <span className="font-sans text-[12px] font-normal text-faint">Revealed at 4:00 PM ET</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {link ? <a href={`/news/${a.ticker}`} className="font-mono font-semibold hover:text-brand">${a.ticker}</a> : <span className="font-mono font-semibold">${a.ticker}</span>}
      {a.tier === "premium" && <span className="rounded bg-brand/15 px-1.5 py-px font-sans text-[10px] font-semibold uppercase tracking-wider text-brand">Premium</span>}
    </span>
  );
}
