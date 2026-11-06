import type { AlertRow } from "@/lib/alerts";
import { links } from "@/lib/site";
import { formatPercent } from "@/lib/format";
import { pct } from "@/lib/alerts";
import { ResultBadge } from "../ResultBadge";
import { SmartLink } from "../SmartLink";
import { ArrowRight, Layers, Shield } from "../Icons";
import { Reveal } from "../Reveal";

/** Decorative order-book depth bars (illustration, no numbers). */
function DepthIllustration() {
  const bids = [92, 78, 66, 51, 40, 28];
  const asks = [34, 45, 58, 70, 81, 95];
  return (
    <div className="grid grid-cols-2 gap-3" aria-hidden="true">
      <div className="space-y-1.5">
        {bids.map((w, i) => (
          <div key={i} className="flex h-5 items-center justify-end overflow-hidden rounded bg-white/[0.02]">
            <div className="h-full rounded bg-brand/25" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        {asks.map((w, i) => (
          <div key={i} className="flex h-5 items-center overflow-hidden rounded bg-white/[0.02]">
            <div className="h-full rounded bg-down/25" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TrackRecordPreview({ alerts }: { alerts: AlertRow[] }) {
  if (!alerts.length) {
    return (
      <div className="mt-6 overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-4 gap-2 border-b border-line bg-bg/50 px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-faint">
          <span>Time (ET)</span><span>Ticker</span><span className="text-right">Alert</span><span className="text-right">Result</span>
        </div>
        <div className="relative px-4 py-10 text-center">
          <div className="space-y-3 opacity-40" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton mx-auto h-3" style={{ width: `${86 - i * 12}%`, animation: "none" }} />)}
          </div>
          <p className="relative mt-6 font-medium">Public track record launching soon</p>
          <p className="relative mx-auto mt-1 max-w-xs text-[13.5px] text-muted">Every alert timestamped. Wins and losses included. Nothing hidden.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-line">
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
                <td className="px-4 py-3 font-mono font-semibold">
                  ${a.ticker}
                  {a.sponsored && <span className="ml-2 rounded bg-white/[0.06] px-1.5 py-px font-sans text-[10px] font-semibold uppercase tracking-wider text-muted" title={a.sponsorComp ?? undefined}>Sponsored</span>}
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

export function Level2AndTrack({ alerts }: { alerts: AlertRow[] }) {
  return (
    <section className="container-wide pb-24 md:pb-32" aria-label="Level 2 streaming and track record">
      <div className="grid gap-5 lg:grid-cols-2">
        <Reveal className="card flex flex-col p-7 md:p-9">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand"><Layers /></span>
          <p className="eyebrow mt-6">Level 2 Streaming</p>
          <h3 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight md:text-[30px]">See the order book, not just the price.</h3>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
            Real-time Level 2 market depth shows you the bids and asks stacking up, so you can see where buyers and sellers are lining up before the move.
          </p>
          <div className="mt-8 rounded-xl border border-line bg-bg/50 p-4">
            <div className="mb-3 flex justify-between text-[11px] uppercase tracking-[0.12em] text-faint"><span>Bids</span><span>Asks</span></div>
            <DepthIllustration />
          </div>
          <div className="mt-8 flex-1" />
          <SmartLink href={links.level2} className="btn-primary self-start">Explore Level 2 <ArrowRight /></SmartLink>
        </Reveal>

        <Reveal delay={120} className="card flex flex-col p-7 md:p-9">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand"><Shield /></span>
          <p className="eyebrow mt-6">Public track record</p>
          <h3 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight md:text-[30px]">Every alert. Wins and losses.</h3>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
            Each alert is timestamped the moment it&apos;s sent and logged here for anyone to check. Sponsored alerts are always labeled.
          </p>
          <TrackRecordPreview alerts={alerts} />
          <div className="mt-8 flex-1" />
          <SmartLink href={links.trackRecord} className="btn-ghost self-start">View full track record <ArrowRight /></SmartLink>
        </Reveal>
      </div>
    </section>
  );
}
