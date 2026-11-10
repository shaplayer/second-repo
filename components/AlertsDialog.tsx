"use client";
import { useEffect, useRef, useState } from "react";
import { AlertForm } from "./AlertForm";
import { Bell, Close } from "./Icons";

const EVENT = "bigstocks:alerts";

/** Open the alerts pop-up from anywhere. Pass a ticker to offer that company's news and filings. */
export function openAlerts(opts: { ticker?: string; source?: string } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: opts }));
}

/** Mounted once in the root layout. */
export function AlertsDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const [opts, setOpts] = useState<{ ticker?: string; source?: string }>({});
  const [n, setN] = useState(0); // remount the form each time it opens

  useEffect(() => {
    const on = (e: Event) => {
      setOpts((e as CustomEvent).detail ?? {});
      setN((x) => x + 1);
      ref.current?.showModal();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  const close = () => ref.current?.close();
  const { ticker } = opts;

  return (
    <dialog
      ref={ref}
      aria-labelledby="alerts-title"
      onClick={(e) => { if (e.target === ref.current) close(); }}
      className="alerts-dialog m-auto w-[calc(100%-32px)] max-w-[460px] rounded-[24px] border border-line-strong bg-surface p-0 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="relative max-h-[calc(100dvh-48px)] overflow-y-auto p-6 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand/15 blur-[60px]" aria-hidden="true" />
        <button type="button" onClick={close} aria-label="Close" className="absolute right-4 top-4 rounded-full p-2 text-faint hover:bg-white/[0.05] hover:text-ink">
          <Close className="h-4 w-4" />
        </button>

        <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand">
          <Bell className="h-5 w-5 animate-bell-ring" />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse-dot rounded-full bg-brand" />
        </span>
        <h2 id="alerts-title" className="mt-5 pr-8 text-[22px] font-semibold leading-tight tracking-tight">
          {ticker ? <>Get <span className="font-mono">${ticker}</span> news the second it drops</> : "Never miss a move"}
        </h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
          {ticker
            ? "Press releases and SEC filings, straight to your inbox and phone. No more refreshing Yahoo Finance."
            : "Winning stock picks, plus breaking press releases and SEC filings, straight to your inbox and phone."}
        </p>

        <div className="mt-6">
          <AlertForm key={n} source={opts.source ?? (ticker ? "bell-ticker" : "bell")} ticker={ticker} layout="stacked"
            cta={ticker ? "Turn on alerts" : "Get free alerts"} />
        </div>
      </div>
    </dialog>
  );
}

/** A button that opens the pop-up (usable from server components). */
export function OpenAlertsButton({ children, className = "btn-primary", source, ticker }: {
  children: React.ReactNode; className?: string; source?: string; ticker?: string;
}) {
  return <button type="button" className={className} onClick={() => openAlerts({ source, ticker })}>{children}</button>;
}
