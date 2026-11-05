import type { FeedItem } from "@/lib/feeds/types";
import { audience, links } from "@/lib/site";
import { compact } from "@/lib/format";
import { Globe } from "../Globe";
import { SignupForm } from "../SignupForm";
import { CountdownInline } from "../Countdown";
import { TimeAgo } from "../TimeAgo";
import { SmartLink } from "../SmartLink";

export function Hero({ latest }: { latest?: FeedItem }) {
  return (
    <section id="signup" className="relative overflow-hidden" aria-labelledby="hero-title">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute right-[-10%] top-[-10%] h-[760px] w-[760px] rounded-full bg-brand/[0.07] blur-[140px]" aria-hidden="true" />

      <div className="container-wide relative grid items-center gap-12 pb-20 pt-14 md:pt-20 lg:grid-cols-[1.15fr_1fr] lg:gap-8 lg:pb-28">
        <div className="relative z-10">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-[12.5px] text-muted backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" />
            Free pre-market stock alerts
          </p>
          <h1 id="hero-title" className="mt-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[50px] xl:text-[56px]">
            See the whole market.
            <br />
            <span className="text-gradient">Catch the big moves first.</span>
          </h1>
          <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed text-muted">
            Our in-house scanners and screeners watch every stock so you don&apos;t have to. When one catches our
            radar, you get the alert before the opening bell.
          </p>

          <div className="mt-9"><SignupForm source="home-hero" /></div>

          <dl className="mt-12 flex max-w-[560px] justify-between gap-6 border-t border-line pt-8 sm:grid sm:grid-cols-3">
            <div>
              <dt className="text-[12.5px] text-faint">Subscribers</dt>
              <dd className="num mt-1 whitespace-nowrap text-[21px] font-semibold tracking-tight sm:text-[26px]">{compact(audience.emailSubscribers)}+</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-faint">Alerts land</dt>
              <dd className="mt-1 whitespace-nowrap text-[21px] font-semibold tracking-tight sm:text-[26px]">Pre-market</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-faint">Cost</dt>
              <dd className="mt-1 whitespace-nowrap text-[21px] font-semibold tracking-tight sm:text-[26px]">$0</dd>
            </div>
          </dl>
        </div>

        <div className="relative mx-auto w-full max-w-[620px]">
          <div className="pointer-events-none absolute inset-[12%] rounded-full bg-brand/10 blur-[80px]" aria-hidden="true" />
          <Globe />

          {latest && (
            <a href={latest.url} target="_blank" rel="noopener noreferrer"
              className="card absolute left-0 top-[14%] hidden w-[250px] p-4 shadow-2xl shadow-black/50 backdrop-blur-md transition-transform hover:-translate-y-0.5 sm:block md:left-[-4%]">
              <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-faint">
                <span>Latest {latest.kind === "filing" ? "filing" : "release"}</span>
                <TimeAgo iso={latest.publishedAt} className="normal-case tracking-normal" />
              </span>
              <span className="mt-2 flex items-center gap-2">
                <span className="font-mono text-[14px] font-semibold">${latest.ticker}</span>
                <span className="rounded-md bg-brand/10 px-1.5 py-px text-[10.5px] font-semibold text-brand">
                  {latest.kind === "filing" ? latest.formType : "PR"}
                </span>
              </span>
              <span className="mt-1.5 line-clamp-2 block text-[13px] leading-snug text-muted">{latest.title}</span>
            </a>
          )}

          <SmartLink href={links.alerts}
            className="card absolute bottom-[12%] right-0 flex items-center gap-3 p-3.5 pr-5 shadow-2xl shadow-black/50 backdrop-blur-md transition-transform hover:-translate-y-0.5 md:right-[-2%]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15">
              <span className="h-2 w-2 animate-pulse-dot rounded-full bg-brand" />
            </span>
            <span>
              <span className="block text-[11px] uppercase tracking-[0.12em] text-faint">Next alert in</span>
              <CountdownInline className="text-[18px] font-semibold" />
            </span>
          </SmartLink>
        </div>
      </div>
    </section>
  );
}
