import { links } from "@/lib/site";
import { CountdownBlocks } from "../Countdown";
import { SmartLink } from "../SmartLink";
import { ArrowRight } from "../Icons";

export function AlertBand() {
  return (
    <section id="alerts" className="container-wide" aria-labelledby="alert-band-title">
      <div className="card relative flex flex-col items-start justify-between gap-8 overflow-hidden p-7 md:flex-row md:items-center md:p-10">
        <div className="pointer-events-none absolute -left-20 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-brand/10 blur-[90px]" aria-hidden="true" />
        <div className="relative">
          <p className="eyebrow"><span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" /> Pre-market alert</p>
          <h2 id="alert-band-title" className="mt-3 text-[26px] font-semibold tracking-tight md:text-[30px]">The next pick drops before the bell.</h2>
          <p className="mt-2 max-w-md text-[15px] text-muted">Subscribers get it first. Open the alert page to watch the countdown live.</p>
        </div>
        <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <CountdownBlocks />
          <SmartLink href={links.alerts} className="btn-primary">Open alert page <ArrowRight /></SmartLink>
        </div>
      </div>
    </section>
  );
}
