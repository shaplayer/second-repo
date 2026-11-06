import { links, plans } from "@/lib/site";
import { SmartLink } from "../SmartLink";
import { OpenAlertsButton } from "../AlertsDialog";
import { ArrowRight, Check, Layers } from "../Icons";

export function premiumHref() {
  return links.premiumCheckout || `${links.premium}#waitlist`;
}

/** Free vs Premium. Level 2 is in beta and labeled that way everywhere. */
export function PricingCards({ source = "pricing" }: { source?: string }) {
  const { free, premium } = plans;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card flex flex-col p-7 md:p-9">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-faint">{free.name}</p>
        <p className="mt-3 flex items-baseline gap-2">
          <span className="num text-[44px] font-semibold leading-none tracking-tight">$0</span>
          <span className="text-[14px] text-muted">forever</span>
        </p>
        <p className="mt-3 text-[15px] text-muted">{free.blurb}</p>
        <ul className="mt-7 space-y-3 text-[15px]">
          {free.features.map((f) => (
            <li key={f} className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span>{f}</span></li>
          ))}
        </ul>
        <div className="mt-auto pt-9">
          <OpenAlertsButton source={`${source}-free`} className="btn-ghost w-full !h-12">Get free alerts <ArrowRight /></OpenAlertsButton>
        </div>
      </div>

      <div className="card relative flex flex-col overflow-hidden border-brand/40 p-7 md:p-9">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/15 blur-[90px]" aria-hidden="true" />
        <div className="relative flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">{premium.name}</p>
          <span className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-[11.5px] font-semibold text-brand">Every pick</span>
        </div>
        <p className="relative mt-3 flex items-baseline gap-2">
          <span className="num text-[44px] font-semibold leading-none tracking-tight">${premium.price}</span>
          <span className="text-[14px] text-muted">/ month</span>
        </p>
        <p className="relative mt-3 text-[15px] text-muted">{premium.blurb}</p>
        <ul className="relative mt-7 space-y-3 text-[15px]">
          {premium.features.filter((f) => !f.startsWith("Level 2")).map((f) => (
            <li key={f} className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span>{f}</span></li>
          ))}
        </ul>
        <div className="relative mt-6 flex items-start gap-3 rounded-2xl border border-dashed border-line-strong bg-bg/50 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-muted"><Layers className="h-4 w-4" /></span>
          <div>
            <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
              Level 2 streaming
              <span className="rounded-full bg-[#f5b84b]/12 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#f5b84b]">Beta · not live yet</span>
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">Real-time order book depth. Premium members get first access when it launches.</p>
          </div>
        </div>
        <div className="relative mt-auto pt-9">
          <SmartLink href={premiumHref()} className="btn-primary w-full !h-12">Get Premium <ArrowRight /></SmartLink>
          <p className="mt-3 text-center text-[12px] text-faint">Cancel anytime. Not investment advice.</p>
        </div>
      </div>
    </div>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="container-wide py-20 md:py-24" aria-labelledby="pricing-title">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Pricing</p>
        <h2 id="pricing-title" className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-tight md:text-[40px]">
          Start free. <span className="text-muted">Go Premium for every pick.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-[16px] text-muted">
          Free members get our free picks and all the news. Premium members get every stock pick we make.
        </p>
      </div>
      <div className="mx-auto mt-12 max-w-[1040px]"><PricingCards /></div>
    </section>
  );
}
