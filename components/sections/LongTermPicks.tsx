import { links } from "@/lib/site";
import { LONG_TERM_PICKS, fmtPickDate, pickGain } from "@/lib/picks";
import { formatPercent, formatPrice } from "@/lib/format";
import { SmartLink } from "../SmartLink";
import { ArrowRight } from "../Icons";
import { Reveal } from "../Reveal";

/** "We called them early": NVDA, AVGO, TSM. Used on the homepage and the track record page. */
export function PickCards() {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {LONG_TERM_PICKS.map((p, i) => {
        const g = pickGain(p);
        return (
          <li key={p.ticker}>
            <Reveal delay={i * 100} className="card flex h-full flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[22px] font-semibold tracking-tight">${p.ticker}</p>
                  <p className="text-[13.5px] text-muted">{p.name}</p>
                </div>
                {g != null && (
                  <span className={`num rounded-full px-2.5 py-1 text-[13px] font-semibold ${g >= 0 ? "bg-brand/12 text-brand" : "bg-down/10 text-down"}`}>
                    {g >= 0 ? "▲" : "▼"} {formatPercent(g)}
                  </span>
                )}
              </div>
              <p className="mt-4 text-[14.5px] leading-relaxed text-muted">{p.thesis}</p>
              <dl className="num mt-auto grid grid-cols-2 gap-3 border-t border-line pt-4 text-[13px]">
                <div>
                  <dt className="text-faint">Picked</dt>
                  <dd className="mt-0.5 text-ink">{fmtPickDate(p.pickedOn)}</dd>
                  {p.priceAtPick != null && <dd className="text-muted">at {formatPrice(p.priceAtPick)}</dd>}
                </div>
                {p.latest && (
                  <div className="text-right">
                    <dt className="text-faint">Close {fmtPickDate(p.latest.asOf).replace(/, \d{4}$/, "")}</dt>
                    <dd className="mt-0.5 text-ink">{formatPrice(p.latest.price)}</dd>
                  </div>
                )}
              </dl>
            </Reveal>
          </li>
        );
      })}
    </ul>
  );
}

export function LongTermPicks() {
  return (
    <section className="container-wide pb-20 pt-10 md:pb-24 md:pt-14" aria-labelledby="picks-title">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <p className="eyebrow">Our picks</p>
          <h2 id="picks-title" className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-tight md:text-[40px]">
            We called them early. <span className="text-muted">Some picks run for a day. Some run for years.</span>
          </h2>
        </div>
        <SmartLink href={links.trackRecord} className="btn-ghost shrink-0 self-start md:self-auto">See every alert <ArrowRight /></SmartLink>
      </div>
      <div className="mt-10"><PickCards /></div>
      <p className="mt-4 max-w-3xl text-[12px] leading-relaxed text-faint">
        Long-term picks from July 2024, before our timestamped track record began, so they&apos;re logged here after the fact.
        Split-adjusted closing prices. Past performance doesn&apos;t guarantee future results. Not investment advice.
      </p>
    </section>
  );
}
