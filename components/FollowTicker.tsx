"use client";
import Link from "next/link";
import { useState } from "react";
import { smsFollowConsentText } from "@/lib/sms-consent";
import { ArrowRight, Bell, Close, Mail, Phone } from "./Icons";

type Channel = "email" | "sms";
type Status = "idle" | "loading" | "error" | "confirm" | "following";

function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Email + SMS buttons to follow one company: its press releases, SEC filings and BigStocks alerts.
 */
export function FollowTicker({ ticker, className = "" }: { ticker: string; className?: string }) {
  const [open, setOpen] = useState<Channel | null>(null);
  const [value, setValue] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<Partial<Record<Channel, Status>>>({});

  const pick = (c: Channel) => {
    setOpen(open === c ? null : c);
    setValue("");
    setConsent(false);
    setStatus("idle");
    setMsg("");
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!open) return;
    setStatus("loading");
    setMsg("");
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker, channel: open, smsConsent: consent,
          [open === "email" ? "email" : "phone"]: value,
          company: new FormData(e.currentTarget).get("company"),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Something went wrong.");
      const s: Status = d.status === "confirm" ? "confirm" : "following";
      setStatus(s);
      setDone((cur) => ({ ...cur, [open]: s }));
    } catch (err) {
      setStatus("error");
      setMsg((err as Error).message);
    }
  }

  const btn = (c: Channel) =>
    `inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13.5px] font-medium transition-colors ${
      open === c ? "border-brand/60 bg-brand/10 text-brand"
        : done[c] ? "border-brand/30 text-brand" : "border-line-strong text-ink hover:border-[#3a434a] hover:bg-white/[0.03]"
    }`;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-[13.5px] text-muted">
          <Bell className="h-4 w-4 text-brand" /> Get <span className="font-mono text-ink">${ticker}</span> alerts
        </span>
        <button type="button" className={btn("email")} aria-expanded={open === "email"} onClick={() => pick("email")}
          title={`Email me when $${ticker} has news, filings or a BigStocks alert`}>
          <Mail className="h-4 w-4" /> {done.email === "following" ? "Following by email" : done.email === "confirm" ? "Check your inbox" : "Email"}
        </button>
        <button type="button" className={btn("sms")} aria-expanded={open === "sms"} onClick={() => pick("sms")}
          title={`Text me when $${ticker} has news, filings or a BigStocks alert`}>
          <Phone className="h-4 w-4" /> {done.sms === "following" ? "Following by text" : "Text"}
        </button>
      </div>

      {open && (
        <div className="card relative mt-3 max-w-[460px] p-5" role="region" aria-label={`${open === "email" ? "Email" : "Text"} alerts for ${ticker}`}>
          <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-faint hover:bg-white/[0.05] hover:text-ink">
            <Close className="h-4 w-4" />
          </button>

          {status === "confirm" || status === "following" ? (
            <div role="status" className="flex items-start gap-3 pr-6">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">✓</span>
              <div>
                <p className="font-semibold">{status === "confirm" ? "Check your inbox" : `You're following $${ticker}`}</p>
                <p className="mt-1 text-[14px] text-muted">
                  {status === "confirm"
                    ? `Click the link we just emailed to start getting $${ticker} alerts.`
                    : open === "sms" ? "A confirmation text is on its way. Reply STOP anytime to cancel." : `You'll get an email when $${ticker} has news, filings or an alert.`}
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={submit}>
              <p className="pr-6 text-[14px] text-muted">
                {open === "email" ? "Email me" : "Text me"} when <span className="font-mono text-ink">${ticker}</span> issues a press release or SEC filing, or when BigStocks sends a free alert on it.
              </p>
              <div className="mt-4 flex h-12 items-center gap-1.5 rounded-full border border-line-strong bg-bg/60 p-1.5 pl-4 focus-within:border-brand/60">
                {open === "sms" && <span className="text-[14px] text-faint" aria-hidden="true">+1</span>}
                <label htmlFor={`follow-${ticker}-${open}`} className="sr-only">{open === "email" ? "Email address" : "Mobile number"}</label>
                <input
                  id={`follow-${ticker}-${open}`} autoFocus required
                  type={open === "email" ? "email" : "tel"} inputMode={open === "email" ? "email" : "tel"}
                  autoComplete={open === "email" ? "email" : "tel-national"}
                  placeholder={open === "email" ? "you@email.com" : "(555) 123-4567"}
                  value={value} onChange={(e) => setValue(open === "sms" ? formatPhone(e.target.value) : e.target.value)}
                  className="num min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
                />
                <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
                <button type="submit" disabled={status === "loading" || (open === "sms" && !consent)} className="btn-primary !h-full shrink-0 !px-4 !text-[14px]">
                  {status === "loading" ? "Saving…" : <>Follow <ArrowRight className="h-3.5 w-3.5" /></>}
                </button>
              </div>
              {open === "sms" && (
                <label className="mt-3 flex cursor-pointer gap-3 text-[11.5px] leading-relaxed text-faint">
                  <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#12e27a]" />
                  <span>{smsFollowConsentText(ticker)} <Link href="/sms-terms" className="text-muted underline underline-offset-2 hover:text-ink">SMS terms</Link></span>
                </label>
              )}
              <p className={`mt-3 text-[12.5px] ${status === "error" ? "text-down" : "text-faint"}`} aria-live="polite">
                {status === "error" ? msg : open === "email" ? "Free. One-click unsubscribe in every email." : "Free. US numbers only."}
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
