"use client";
import { useState } from "react";
import type { FeedItem } from "@/lib/feeds/types";
import { openAlerts } from "../AlertsDialog";
import { ArrowRight, Bell, Doc, Mail, Megaphone, Phone, TrendUp } from "../Icons";

type Tab = "alerts" | "press" | "filings";

const TABS: { id: Tab; icon: typeof TrendUp; title: string; line: string; detail: string }[] = [
  { id: "alerts", icon: TrendUp, title: "Stock alerts", line: "Our picks, sent to you.",
    detail: "Short-term movers and longer-term holds our scanners and team flag, with the price when we sent it." },
  { id: "press", icon: Megaphone, title: "Press releases", line: "Company news as it hits the wire.",
    detail: "Earnings, FDA decisions, contracts and buyouts for the stocks you follow, or the ones that hit our radar." },
  { id: "filings", icon: Doc, title: "SEC filings", line: "Straight from SEC EDGAR.",
    detail: "8-Ks, 10-Qs, S-1s and insider filings, in plain English, a few seconds after they post." },
];

const BENEFITS = [
  ["Save time", "One place instead of five finance sites."],
  ["Hear it first", "Seconds after it posts, not hours."],
  ["Only your stocks", "Follow the tickers you own. Skip the rest."],
  ["Free to start", "Upgrade to Premium when you want every pick."],
] as const;

function preview(tab: Tab, items: FeedItem[]) {
  const press = items.find((i) => i.kind === "press" && i.ticker);
  const filing = items.find((i) => i.kind === "filing" && i.ticker);
  if (tab === "press" && press) return { ticker: press.ticker!, sms: `$${press.ticker} press release: ${press.title}`, subject: `$${press.ticker}: new press release` };
  if (tab === "filings" && filing) return { ticker: filing.ticker!, sms: `New ${filing.formType ?? "SEC filing"} from $${filing.ticker}: ${filing.title}`, subject: `$${filing.ticker}: new ${filing.formType ?? "SEC"} filing` };
  if (tab === "press") return { ticker: "", sms: "$TICKER press release: Company reports record quarterly revenue", subject: "$TICKER: new press release" };
  if (tab === "filings") return { ticker: "", sms: "New 8-K from $TICKER: Entry into a material agreement", subject: "$TICKER: new 8-K filing" };
  return { ticker: "", sms: null, subject: "Today's pick is live" };
}

export function WhatYouGet({ items = [] }: { items?: FeedItem[] }) {
  const [tab, setTab] = useState<Tab>("alerts");
  const [ticker, setTicker] = useState("");
  const p = preview(tab, items);
  const t = ticker.trim().toUpperCase().replace(/^\$/, "");
  const validTicker = /^[A-Z]{1,5}(\.[A-Z])?$/.test(t);

  const follow = (e: React.FormEvent) => {
    e.preventDefault();
    openAlerts(validTicker ? { ticker: t, source: "what-you-get-ticker" } : { source: "what-you-get" });
  };

  return (
    <section className="container-wide pb-16 pt-4 md:pb-20 md:pt-6" aria-labelledby="get-title">
      <div className="max-w-2xl">
        <p className="eyebrow">What you get</p>
        <h2 id="get-title" className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-tight md:text-[40px]">
          Three things, delivered. <span className="text-muted">Nothing to go digging for.</span>
        </h2>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* What you get: pick one to see what it looks like */}
        <div role="tablist" aria-label="What you get" className="grid content-start gap-3">
          {TABS.map((x) => {
            const on = tab === x.id;
            return (
              <button key={x.id} role="tab" aria-selected={on} aria-controls="get-preview" onClick={() => setTab(x.id)}
                className={`group flex w-full items-start gap-4 rounded-2xl border p-5 text-left transition-all md:p-6 ${on ? "border-brand/50 bg-brand/[0.06] shadow-[0_0_0_1px_rgba(18,226,122,0.15),0_20px_60px_-30px_rgba(18,226,122,0.5)]" : "border-line bg-surface hover:border-line-strong"}`}>
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors ${on ? "border-brand/40 bg-brand/15 text-brand" : "border-line-strong text-muted group-hover:text-ink"}`}>
                  <x.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[18px] font-semibold tracking-tight">{x.title}</span>
                    <span className="hidden text-[14px] text-muted sm:inline">{x.line}</span>
                  </span>
                  <span className={`mt-1.5 block text-[14.5px] leading-relaxed ${on ? "text-ink/85" : "text-muted"}`}>{x.detail}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* How it shows up */}
        <div id="get-preview" role="tabpanel" className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-6 py-3.5 text-[12px] uppercase tracking-[0.12em] text-faint">
            <span>How it shows up</span>
            <span className="inline-flex items-center gap-1.5 normal-case tracking-normal"><span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" /> seconds after it posts</span>
          </div>
          <div className="space-y-4 p-6">
            {/* Text message */}
            <div>
              <p className="mb-2 flex items-center gap-2 text-[12px] text-faint"><Phone className="h-3.5 w-3.5 text-brand" /> Text message · now</p>
              <div key={tab} className="get-bubble max-w-[420px] rounded-[20px] rounded-bl-md bg-white/[0.08] px-4 py-3 text-[14.5px] leading-snug text-ink">
                <span className="font-semibold">BigStocks: </span>
                {p.sms ?? <>Today&apos;s pick is live: <span className="mx-0.5 inline-block h-[1em] w-14 translate-y-[2px] rounded bg-brand/30 blur-[2px]" aria-label="ticker hidden" /> Tap for the details.</>}
              </div>
            </div>
            {/* Email */}
            <div>
              <p className="mb-2 flex items-center gap-2 text-[12px] text-faint"><Mail className="h-3.5 w-3.5 text-brand" /> Email · now</p>
              <div key={`${tab}-mail`} className="get-bubble flex items-center gap-3 rounded-xl border border-line bg-bg/60 px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-[#04130b]"><TrendUp className="h-4 w-4" /></span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">BigStocks</span>
                  <span className="block truncate text-[13.5px] text-muted">{p.subject}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="mt-auto border-t border-line bg-bg/40 p-5 md:p-6">
            {tab === "alerts" ? (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => openAlerts({ source: "what-you-get-alerts" })} className="btn-primary">Get stock alerts <ArrowRight /></button>
                <span className="text-[13px] text-muted">Free picks several times a week.</span>
              </div>
            ) : (
              <form onSubmit={follow} className="flex flex-wrap items-center gap-3">
                <label htmlFor="get-ticker" className="text-[14px] text-muted">Own a stock?</label>
                <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-line-strong bg-surface pl-4 pr-1.5 focus-within:border-brand/60">
                  <input id="get-ticker" value={ticker} onChange={(e) => setTicker(e.target.value.slice(0, 8))} placeholder={p.ticker || "AAPL"}
                    autoComplete="off" spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[14px] uppercase text-ink placeholder:font-sans placeholder:normal-case placeholder:text-faint focus:outline-none" />
                  <button type="submit" className="bell-halo relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 text-[13px] font-semibold text-[#04130b]">
                    <Bell className="h-3.5 w-3.5" /> Get its news
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Benefits + delivery choice */}
      <div className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {BENEFITS.map(([h, b]) => (
          <div key={h} className="bg-surface p-5">
            <p className="text-[15px] font-semibold">{h}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{b}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px] text-muted">
        <span className="mr-1">Get it by</span>
        <button type="button" onClick={() => openAlerts({ source: "what-you-get-text" })}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3.5 font-medium text-brand transition-colors hover:bg-brand/20">
          <Phone className="h-4 w-4" /> Text <span className="text-[11px] font-semibold opacity-80">Recommended</span>
        </button>
        <button type="button" onClick={() => openAlerts({ source: "what-you-get-email" })}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-3.5 font-medium text-ink transition-colors hover:bg-white/[0.04]">
          <Mail className="h-4 w-4 text-brand" /> Email
        </button>
        <span>or both. Unsubscribe anytime.</span>
      </div>
    </section>
  );
}
