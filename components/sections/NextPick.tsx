"use client";
import { useEffect, useState } from "react";
import { alertWindow, links } from "@/lib/site";
import { etLabel, pickSchedule, type PickSchedule } from "@/lib/schedule";
import { openAlerts } from "../AlertsDialog";
import { SmartLink } from "../SmartLink";
import { ArrowRight } from "../Icons";

const pad = (n: number) => String(n).padStart(2, "0");
const START = etLabel(alertWindow.startHourET, alertWindow.startMinuteET);
const OPEN = etLabel(alertWindow.endHourET, alertWindow.endMinuteET);

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Countdown to the next 8:00–9:30 AM ET pick window. Replaces the old "our picks" section. */
export function NextPick() {
  const [sch, setSch] = useState<PickSchedule | null>(null);
  useEffect(() => {
    const tick = () => setSch(pickSchedule());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const t = sch ? parts(sch.msLeft) : null;
  const blocks: [string, string][] = t
    ? [...(t.d ? [["Days", String(t.d)] as [string, string]] : []), ["Hours", pad(t.h)], ["Min", pad(t.m)], ["Sec", pad(t.s)]]
    : [["Hours", "--"], ["Min", "--"], ["Sec", "--"]];

  const status = !sch ? " "
    : sch.phase === "window" ? "The pick window is open. A pick can drop any minute."
    : sch.phase === "market" ? `Market's open, we're watching for setups. Next window: ${sch.nextDay.toLowerCase()}, ${START} ET.`
    : `Next pick window opens ${sch.nextDay.toLowerCase()} at ${START} ET.`;
  const label = sch?.phase === "window" ? "Until the opening bell" : "Until the pick window opens";

  return (
    <section className="container-wide pb-16 pt-6 md:pb-20 md:pt-10" aria-labelledby="next-title">
      <div className="card relative grid gap-10 overflow-hidden p-7 md:p-10 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14">
        <div className="pointer-events-none absolute -left-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-brand/10 blur-[100px]" aria-hidden="true" />
        <div className="relative">
          <p className="eyebrow"><span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" /> Next pick</p>
          <h2 id="next-title" className="mt-4 text-[30px] font-semibold leading-[1.1] tracking-tight md:text-[38px]">
            Get the next pick <span className="text-gradient">straight to your phone.</span>
          </h2>
          <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-muted">
            Picks go out between {START} and {OPEN} ET, pre-market or right at the opening bell. If a setup pops up during
            market hours, we send that too. Don&apos;t find out after the move.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={() => openAlerts({ source: "next-pick" })} className="btn-primary">Get the next pick <ArrowRight /></button>
            <SmartLink href={links.alerts} className="btn-ghost !h-12">Open the alert page</SmartLink>
          </div>
        </div>

        <div className="relative rounded-2xl border border-line bg-bg/60 p-6 md:p-8">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</p>
          <div className="mt-4 flex items-start gap-2 sm:gap-3" role="timer" aria-live="off">
            {blocks.map(([k, v], i) => (
              <div key={k} className="flex items-start gap-2 sm:gap-3">
                <div className="flex flex-col items-center">
                  <span className="num min-w-[2.4ch] rounded-xl border border-line-strong bg-surface px-2.5 py-2.5 text-center text-[32px] font-semibold leading-none tracking-tight sm:text-[44px]">{v}</span>
                  <span className="mt-2 text-[11px] uppercase tracking-[0.14em] text-faint">{k}</span>
                </div>
                {i < blocks.length - 1 && <span className="pt-3 text-[26px] text-faint">:</span>}
              </div>
            ))}
          </div>

          {/* The window: 8:00 AM ET → 9:30 AM opening bell */}
          <div className="mt-8">
            <div className="relative h-2 rounded-full bg-white/[0.06]">
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand/40 to-brand transition-[width] duration-1000"
                style={{ width: `${sch?.phase === "window" ? Math.max(4, sch.windowProgress * 100) : 0}%` }} />
              {sch?.phase === "window" && (
                <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 animate-pulse-dot rounded-full border-2 border-bg bg-brand"
                  style={{ left: `${Math.max(4, sch.windowProgress * 100)}%` }} />
              )}
            </div>
            <div className="mt-2.5 flex justify-between text-[12px] text-faint">
              <span><span className="num text-ink">{START}</span> ET<span className="hidden sm:inline"> · Pre-market</span></span>
              <span><span className="num text-ink">{OPEN}</span> ET<span className="hidden sm:inline"> · Opening bell</span></span>
            </div>
          </div>
          <p className={`mt-5 text-[13.5px] ${sch?.phase === "window" ? "text-brand" : "text-muted"}`} aria-live="polite">{status}</p>
        </div>
      </div>
    </section>
  );
}
