import type { AlertRow } from "@/lib/alerts";
import { links } from "@/lib/site";
import { SmartLink } from "../SmartLink";
import { TrackRecordTable } from "../TrackRecordTable";
import { ArrowRight, Shield } from "../Icons";

export function TrackRecordSection({ alerts }: { alerts: AlertRow[] }) {
  return (
    <section className="container-wide py-20 md:py-24" aria-labelledby="track-title">
      <div className="card grid gap-10 p-7 md:p-10 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-14">
        <div>
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand"><Shield /></span>
          <p className="eyebrow mt-6">Public track record</p>
          <h2 id="track-title" className="mt-3 text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">Every alert, timestamped. Wins and losses.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            Each alert is logged the moment it&apos;s sent and can never be edited or deleted. Sponsored alerts are always labeled.
          </p>
          <SmartLink href={links.trackRecord} className="btn-ghost mt-8">View full track record <ArrowRight /></SmartLink>
        </div>
        <TrackRecordTable alerts={alerts} />
      </div>
    </section>
  );
}
