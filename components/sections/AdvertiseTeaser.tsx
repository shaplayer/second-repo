import { audience, links } from "@/lib/site";
import { PACKAGES, formatUSD } from "@/lib/advertise";
import { compact } from "@/lib/format";
import { SmartLink } from "../SmartLink";
import { ArrowRight } from "../Icons";
import { Reveal } from "../Reveal";

export function AdvertiseTeaser() {
  return (
    <section id="advertise" className="container-wide pb-24 md:pb-32" aria-labelledby="adv-title">
      <div className="card relative overflow-hidden p-7 md:p-12 lg:p-16">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[480px] w-[480px] rounded-full bg-brand/[0.09] blur-[120px]" aria-hidden="true" />
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />

        <div className="relative grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-end">
          <div>
            <p className="eyebrow">For public companies</p>
            <h2 id="adv-title" className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[46px]">
              Put your news in front of{" "}
              <span className="num text-gradient">{audience.emailSubscribers.toLocaleString("en-US")}</span> traders.
            </h2>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-muted">
              <span className="num text-ink">{compact(audience.dailyImpressions)}+</span> impressions and{" "}
              <span className="num text-ink">{audience.dailyClicks.toLocaleString("en-US")}+</span> clicks every day. More visibility and
              more exposure for your announcements, with every sponsored placement disclosed so investors trust what they read.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <SmartLink href={links.advertise} className="btn-primary">See packages &amp; audience <ArrowRight /></SmartLink>
              <SmartLink href={`${links.advertise}#contact`} className="btn-ghost !h-12">Talk to our team</SmartLink>
            </div>
          </div>

          <ul className="grid gap-3">
            {PACKAGES.map((p, i) => (
              <li key={p.id}>
                <Reveal delay={i * 100}>
                  <SmartLink href={`${links.advertise}?package=${p.id}#contact`}
                    className={`group flex items-start justify-between gap-6 rounded-2xl border bg-bg/60 p-5 backdrop-blur transition-colors hover:border-brand/40 ${p.featured ? "border-brand/30" : "border-line"}`}>
                    <span className="min-w-0">
                      <span className="block text-[16px] font-semibold">{p.name}</span>
                      <span className="mt-1 block text-[14px] leading-relaxed text-muted">{p.summary}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-[18px] font-semibold">{formatUSD(p.price)}</span>
                      <span className="block text-[12px] text-faint">{p.cadence}</span>
                    </span>
                  </SmartLink>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
