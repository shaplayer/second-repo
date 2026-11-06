import type { AlertRow } from "@/lib/alerts";
import { pct } from "@/lib/alerts";
import { formatPercent } from "@/lib/format";
import { ResultBadge } from "./ResultBadge";
import { TickerCell } from "./TierLabel";

/** Recent timestamped alerts (from the permanent track record). */
export function TrackRecordTable({ alerts }: { alerts: AlertRow[] }) {
  if (!alerts.length) {
    return (
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-4 gap-2 border-b border-line bg-bg/50 px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-faint">
          <span>Time (ET)</span><span>Ticker</span><span className="text-right">Alert</span><span className="text-right">Result</span>
        </div>
        <div className="relative px-4 py-10 text-center">
          <div className="space-y-3 opacity-40" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton mx-auto h-3" style={{ width: `${86 - i * 12}%`, animation: "none" }} />)}
          </div>
          <p className="relative mt-6 font-medium">Timestamped alerts show up here</p>
          <p className="relative mx-auto mt-1 max-w-xs text-[13.5px] text-muted">Every alert, logged the moment it&apos;s sent. Wins and losses included.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="num w-full text-[13.5px]">
        <thead className="border-b border-line bg-bg/50 text-[11px] uppercase tracking-[0.12em] text-faint">
          <tr><th className="px-4 py-2.5 text-left font-medium">Time (ET)</th><th className="px-4 py-2.5 text-left font-medium">Ticker</th><th className="px-4 py-2.5 text-right font-medium">Close</th><th className="px-4 py-2.5 text-right font-medium">Result</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {alerts.map((a) => {
            const p = pct(a.alertPrice, a.closeAfter);
            return (
              <tr key={a.id}>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{new Date(a.alertedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <TickerCell a={a} />
                  {!a.hidden && a.sponsored && <span className="ml-2 rounded bg-white/[0.06] px-1.5 py-px font-sans text-[10px] font-semibold uppercase tracking-wider text-muted" title={a.sponsorComp ?? undefined}>Sponsored</span>}
                </td>
                <td className={`px-4 py-3 text-right ${p == null ? "text-faint" : p > 0 ? "text-brand" : p < 0 ? "text-down" : "text-muted"}`}>{formatPercent(p)}</td>
                <td className="px-4 py-3 text-right"><ResultBadge result={a.result} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
