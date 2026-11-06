import type { FeedItem } from "@/lib/feeds/types";
import { alertTiming, audience } from "@/lib/site";
import { compact } from "@/lib/format";
import { SignupForm } from "../SignupForm";
import { TimeAgo } from "../TimeAgo";
import { FeedSearch } from "../FeedSearch";
import { ChartVisual } from "../hero/ChartVisual";

export function Hero({ items }: { items: FeedItem[] }) {
  const latest = items.find((i) => i.ticker);

  return (
    <section id="signup" className="relative overflow-hidden" aria-labelledby="hero-title">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute right-[-10%] top-[-10%] h-[760px] w-[760px] rounded-full bg-brand/[0.07] blur-[140px]" aria-hidden="true" />

      <div className="container-wide relative grid grid-cols-1 items-center gap-10 pb-8 pt-12 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-12">
        <div className="relative z-10 min-w-0">
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-[12.5px] text-muted backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" />
            <span className="text-ink">Live</span>
            <span aria-hidden="true">·</span> Stock alerts <span aria-hidden="true">·</span> Press releases <span aria-hidden="true">·</span> SEC filings
          </p>
          <h1 id="hero-title" className="mt-6 text-[38px] font-semibold leading-[1.06] tracking-[-0.03em] sm:text-[48px] xl:text-[56px]">
            Big stock alerts and breaking news,{" "}
            <span className="text-gradient">on your phone in seconds.</span>
          </h1>
          <p className="mt-6 max-w-[540px] text-[17px] leading-relaxed text-muted">
            Our stock picks, plus press releases and SEC filings the moment they post. By text and email, so you&apos;re
            not refreshing five finance sites to find out what happened.
          </p>

          <div className="mt-8"><SignupForm source="home-hero" /></div>

          <dl className="mt-10 grid max-w-[540px] grid-cols-3 gap-4 border-t border-line pt-7">
            <div>
              <dt className="text-[12.5px] text-faint">Investors</dt>
              <dd className="num mt-1 whitespace-nowrap text-[20px] font-semibold tracking-tight sm:text-[24px]">{compact(audience.emailSubscribers)}+</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-faint">Delivered</dt>
              <dd className="mt-1 whitespace-nowrap text-[20px] font-semibold tracking-tight sm:text-[24px]">In seconds</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-faint">To start</dt>
              <dd className="mt-1 whitespace-nowrap text-[20px] font-semibold tracking-tight sm:text-[24px]">Free</dd>
            </div>
          </dl>
        </div>

        <div className="relative">
          {/* Quick news search: small and out of the way, but right there. */}
          <div className="relative z-10 mb-3 w-full sm:absolute sm:left-0 sm:top-[2%] sm:mb-0 sm:w-[300px]">
            <FeedSearch size="sm" placeholder="Search a ticker for news" />
          </div>

          <div className="relative h-[360px] w-full sm:h-[500px] lg:h-[580px]">
            <div className="pointer-events-none absolute inset-[15%] rounded-full bg-brand/10 blur-[90px]" aria-hidden="true" />
            <ChartVisual />

            {latest && (
              <a href={latest.url} target="_blank" rel="noopener noreferrer"
                className="card absolute left-0 top-[14%] hidden w-[300px] p-4 shadow-2xl shadow-black/50 backdrop-blur-md transition-transform hover:-translate-y-0.5 sm:block">
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

            <div className="card absolute bottom-[2%] right-0 hidden items-center gap-3 p-3.5 pr-5 shadow-2xl shadow-black/50 backdrop-blur-md sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-brand" />
              </span>
              <span>
                <span className="block text-[11px] uppercase tracking-[0.12em] text-faint">Next pick</span>
                <span className="block text-[15px] font-semibold">{alertTiming.short}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
