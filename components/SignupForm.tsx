"use client";
import Link from "next/link";
import { useState } from "react";
import { SMS_CONSENT_TEXT } from "@/lib/sms-consent";
import { ArrowRight, Mail, Phone } from "./Icons";

type Status = "idle" | "loading" | "done" | "error";
type Channel = "email" | "sms";

/** Formats as (555) 123-4567 while typing. */
function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function SignupForm({ source, size = "lg" }: { source: string; size?: "lg" | "md" }) {
  const [channel, setChannel] = useState<Channel>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [done, setDone] = useState<Channel | null>(null);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setStatus("loading");
    setMsg("");
    try {
      const payload = channel === "email"
        ? { channel, email, source, company: form.get("company") }
        : { channel, phone, smsConsent: consent, source, company: form.get("company") };
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setDone(channel);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMsg((err as Error).message);
    }
  }

  if (status === "done") {
    return (
      <div className="card flex w-full max-w-[520px] items-center gap-4 p-5 text-left" role="status">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">✓</span>
        <div>
          <p className="font-semibold">You&apos;re in.</p>
          <p className="text-[14px] text-muted">
            {done === "sms"
              ? "Check your phone for a confirmation text. Alerts arrive before the bell."
              : "Watch your inbox before the bell. Your first alert is on its way."}
          </p>
        </div>
      </div>
    );
  }

  const h = size === "lg" ? "h-14" : "h-12";
  const tab = (c: Channel) =>
    `inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors ${channel === c ? "bg-white/[0.07] text-ink" : "text-muted hover:text-ink"}`;

  return (
    <div className="w-full max-w-[520px] text-left">
      <div role="tablist" aria-label="Alert channel" className="mb-3 inline-flex rounded-full border border-line bg-surface p-1 text-[13px]">
        <button type="button" role="tab" aria-selected={channel === "email"} onClick={() => { setChannel("email"); setStatus("idle"); }} className={tab("email")}>
          <Mail className="h-3.5 w-3.5" /> Email
        </button>
        <button type="button" role="tab" aria-selected={channel === "sms"} onClick={() => { setChannel("sms"); setStatus("idle"); }} className={tab("sms")}>
          <Phone className="h-3.5 w-3.5" /> Text (SMS)
        </button>
      </div>

      <form onSubmit={submit}>
        <div className={`flex ${h} items-center gap-1.5 rounded-full border border-line-strong bg-surface p-1.5 pl-5 transition-colors focus-within:border-brand/60`}>
          {channel === "email" ? (
            <>
              <label htmlFor={`email-${source}`} className="sr-only">Email address</label>
              <input
                id={`email-${source}`} type="email" required autoComplete="email" inputMode="email"
                placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
              />
            </>
          ) : (
            <>
              <label htmlFor={`phone-${source}`} className="sr-only">Mobile number</label>
              <span className="text-[15px] text-faint" aria-hidden="true">+1</span>
              <input
                id={`phone-${source}`} type="tel" required autoComplete="tel-national" inputMode="tel"
                placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))}
                className="num min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
              />
            </>
          )}
          {/* Honeypot */}
          <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          <button type="submit" disabled={status === "loading" || (channel === "sms" && !consent)} className="btn-primary !h-full shrink-0 !px-5">
            {status === "loading" ? "Joining…" : size === "md" ? <>Join free <ArrowRight /></> : <>Get alerts free <ArrowRight /></>}
          </button>
        </div>

        {channel === "sms" && (
          <label className="mt-3 flex cursor-pointer gap-3 text-[11.5px] leading-relaxed text-faint">
            <input
              type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#12e27a]"
            />
            <span>
              {SMS_CONSENT_TEXT}{" "}
              <Link href="/sms-terms" className="text-muted underline underline-offset-2 hover:text-ink">SMS terms</Link>
            </span>
          </label>
        )}
      </form>

      <p className={`mt-3 text-[12.5px] ${status === "error" ? "text-down" : "text-faint"}`} aria-live="polite">
        {status === "error" ? msg : channel === "email" ? "Free forever. One-click unsubscribe. Not investment advice." : "Free. US numbers only. Not investment advice."}
      </p>
    </div>
  );
}
