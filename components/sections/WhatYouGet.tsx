import { Bell, Doc, Mail, Megaphone, Phone, TrendUp } from "../Icons";
import { Reveal } from "../Reveal";

const PILLARS = [
  {
    icon: TrendUp,
    eyebrow: "Stock alerts",
    title: "Winning picks from our scanners",
    body: "Our in-house scanners sweep the whole market for volume, momentum and catalysts. When a stock makes the cut, you get the alert. One-day movers and long-term holds.",
    sample: { tag: "ALERT", tone: "brand", text: "Today's pick is live. Open to see the ticker." },
  },
  {
    icon: Megaphone,
    eyebrow: "Press releases",
    title: "Company news, the second it hits the wire",
    body: "Earnings, FDA decisions, contracts, buyouts. Straight from the newswires, not 30 minutes later on a finance portal.",
    sample: { tag: "PR", tone: "brand", text: "Company announces record Q3 revenue" },
  },
  {
    icon: Doc,
    eyebrow: "SEC filings",
    title: "8-Ks, 10-Qs, S-1s and more from EDGAR",
    body: "Offerings, insider moves, material events. Filings move stocks fast, and most investors find out late.",
    sample: { tag: "8-K", tone: "blue", text: "Current report: material agreement" },
  },
] as const;

export function WhatYouGet() {
  return (
    <section className="container-wide py-20 md:py-24" aria-labelledby="get-title">
      <div className="max-w-3xl">
        <p className="eyebrow">What you get</p>
        <h2 id="get-title" className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-tight md:text-[40px]">
          The three things that move stocks. <span className="text-muted">Sent to you first.</span>
        </h2>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-muted">
          When a filing or press release drops, the stock can move in minutes. If you hear about it an hour later,
          the gains are already gone. BigStocks puts it on your phone and in your inbox the moment it posts.
        </p>
      </div>

      <ol className="mt-12 grid gap-4 md:grid-cols-3">
        {PILLARS.map((p, i) => (
          <li key={p.eyebrow} className="min-w-0">
            <Reveal delay={i * 110} className="card flex h-full flex-col p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand">
                <p.icon className="h-5 w-5" />
              </span>
              <p className="mt-6 text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">{p.eyebrow}</p>
              <h3 className="mt-2 text-[19px] font-semibold leading-snug tracking-tight">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{p.body}</p>
              <div className="mt-auto pt-6">
                <div className="flex items-center gap-2.5 rounded-xl border border-line bg-bg/60 px-3.5 py-3 text-[13px]">
                  <span className={`rounded-md px-1.5 py-px font-mono text-[10.5px] font-semibold ${p.sample.tone === "blue" ? "bg-[#7fb8ff]/10 text-[#7fb8ff]" : "bg-brand/10 text-brand"}`}>{p.sample.tag}</span>
                  <span className="min-w-0 truncate text-muted">{p.sample.text}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-faint">now</span>
                </div>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-col items-start gap-4 rounded-2xl border border-line bg-surface/60 px-6 py-5 md:flex-row md:items-center md:justify-between">
        <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14.5px] text-muted">
          <span className="inline-flex items-center gap-2 text-ink"><Mail className="h-4 w-4 text-brand" /> Email</span>
          <span className="inline-flex items-center gap-2 text-ink"><Phone className="h-4 w-4 text-brand" /> Text (SMS)</span>
          <span>Turn on one or both. Unsubscribe anytime.</span>
        </p>
        <p className="inline-flex items-center gap-2 text-[14px] text-muted">
          <Bell className="h-4 w-4 text-brand" /> Own a stock? Hit the bell on any ticker to get its news and filings.
        </p>
      </div>
    </section>
  );
}
