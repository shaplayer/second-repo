import type { FeedItem } from "@/lib/feeds/types";
import { alertTiming, audience } from "@/lib/site";
import { compact, formatPrice } from "@/lib/format";
import { LONG_TERM_PICKS, fmtPickDate } from "@/lib/picks";
import { SignupForm } from "../SignupForm";
import { TimeAgo } from "../TimeAgo";
import { ChartVisual } from "../hero/ChartVisual";
import { FlowVisual } from "../hero/FlowVisual";
import { PhoneVisual } from "../hero/PhoneVisual";

export type HeroVisual = "chart" | "flow" | "phone";

export function Hero({ items, visual = "chart" }: { items: FeedItem[]; visual?: HeroVisual }) {
  const latest = items.find((i) => i.ticker);
  const tickers = [...new Set(items.map((i) => i.ticker).filter(Boolean) as string[])];
  const star = LONG_TERM_PICKS.find((p) => p.priceAtPick != null);

  return (
    <section id="signup" className="relative overflow-hidden" aria-labelledby="hero-title">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute right-[-10%] top-[-10%] h-[760px] w-[760px] rounded-full bg-brand/[0.07] blur-[140px]" aria-hidden="true" />

      <div className="container-wide relative grid items-center gap-10 pb-8 pt-12 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-12">
        <div className="relative z-10">
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-[12.5px] text-muted backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" />
            <span className="text-ink">Live</span>
            <span aria-hidden="true">·</span> Stock alerts <span aria-hidden="true">·</span> Press releases <span aria-hidden="true">·</span> SEC filings
          </p>
          <h1 id="hero-title" className="mt-6 text-[38px] font-semibold leading-[1.06] tracking-[-0.03em] sm:text-[48px] xl:text-[56px]">
            Winning stock alerts and breaking news,{" "}
            <span className="text-gradient">straight to your phone.</span>
          </h1>
          <p className="mt-6 max-w-[540px] text-[17px] leading-relaxed text-muted">
            We send you our stock picks, plus every press release and SEC filing the moment it posts, by text and email.
            Stop digging through Yahoo Finance. Stop missing the move.
          </p>

          <div className="mt-8"><SignupForm source="home-hero" /></div>

          <dl className="mt-10 grid max-w-[560px] grid-cols-3 gap-4 border-t border-line pt-7">
            <div>
              <dt className="text-[12.5px] text-faint">Investors</dt>
              <dd className="num mt-1 whitespace-nowrap text-[20px] font-semibold tracking-tight sm:text-[24px]">{compact(audience.emailSubscribers)}+</dd>
            </div>
            {star && (
              <div>
                <dt className="whitespace-nowrap text-[12.5px] text-faint">Called ${star.ticker}</dt>
                <dd className="num mt-1 whitespace-nowrap text-[20px] font-semibold tracking-tight sm:text-[24px]">{formatPrice(star.priceAtPick)}</dd>
                <dd className="mt-0.5 text-[12px] text-faint">{fmtPickDate(star.pickedOn).replace(/ \d+,/, "")}</dd>
              </div>
            )}
            <div>
              <dt className="text-[12.5px] text-faint">To start</dt>
              <dd className="mt-1 whitespace-nowrap text-[20px] font-semibold tracking-tight sm:text-[24px]">Free</dd>
            </div>
          </dl>
        </div>

        <div className="relative h-[400px] w-full sm:h-[500px] lg:h-[580px]">
          <div className="pointer-events-none absolute inset-[15%] rounded-full bg-brand/10 blur-[90px]" aria-hidden="true" />
          {visual === "phone" ? <PhoneVisual items={items} />
            : visual === "flow" ? <FlowVisual tickers={tickers} />
            : <ChartVisual />}

          {visual !== "phone" && latest && (
            <a href={latest.url} target="_blank" rel="noopener noreferrer"
              className="card absolute left-0 top-[4%] hidden w-[260px] p-4 shadow-2xl shadow-black/50 backdrop-blur-md transition-transform hover:-translate-y-0.5 sm:block">
              <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-faint">
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" /> Just posted</span>
                <TimeAgo iso={latest.publishedAt} className="normal-case tracking-normal" />
              </span>
              <span className="mt-2 flex items-center gap-2">
                <span className="font-mono text-[14px] font-semibold">${latest.ticker}</span>
                <span className={`rounded-md px-1.5 py-px text-[10.5px] font-semibold ${latest.kind === "filing" ? "bg-[#7fb8ff]/10 text-[#7fb8ff]" : "bg-brand/10 text-brand"}`}>
                  {latest.kind === "filing" ? latest.formType : "PR"}
                </span>
              </span>
              <span className="mt-1.5 line-clamp-2 block text-[13px] leading-snug text-muted">{latest.title}</span>
            </a>
          )}

          {visual !== "phone" && (
            <div className="card absolute bottom-[2%] right-0 hidden items-center gap-3 p-3.5 pr-5 shadow-2xl shadow-black/50 backdrop-blur-md sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-brand" />
              </span>
              <span>
                <span className="block text-[11px] uppercase tracking-[0.12em] text-faint">Next pick</span>
                <span className="block text-[15px] font-semibold">{alertTiming.short}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
