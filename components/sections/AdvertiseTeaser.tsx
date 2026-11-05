import { audience, links } from "@/lib/site";
import { SmartLink } from "../SmartLink";
import { ArrowRight } from "../Icons";
import { Reveal } from "../Reveal";

const PACKAGES = [
  { name: "Sponsored Alert", body: "Your company featured in a pre-market alert to our full subscriber list, clearly labeled as sponsored." },
  { name: "Featured News", body: "Your press release pinned at the top of our News & Filings feed, where traders look first." },
  { name: "Full Campaign", body: "A multi-week mix of alerts, featured news and site placement, with reporting at the end." },
];

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
              More visibility, more exposure, and investors who actually see your announcements. Every sponsored
              placement is disclosed, so your audience trusts what it reads.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <SmartLink href={links.advertise} className="btn-primary">See packages &amp; audience <ArrowRight /></SmartLink>
              <SmartLink href={`${links.advertise}#contact`} className="btn-ghost !h-12">Talk to our team</SmartLink>
            </div>
          </div>

          <ul className="grid gap-3">
            {PACKAGES.map((p, i) => (
              <li key={p.name}>
                <Reveal delay={i * 100}>
                  <SmartLink href={links.advertise}
                    className="group flex items-start justify-between gap-6 rounded-2xl border border-line bg-bg/60 p-5 backdrop-blur transition-colors hover:border-brand/40">
                    <span>
                      <span className="block text-[16px] font-semibold">{p.name}</span>
                      <span className="mt-1 block text-[14px] leading-relaxed text-muted">{p.body}</span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-faint transition-all group-hover:translate-x-0.5 group-hover:text-brand" />
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
