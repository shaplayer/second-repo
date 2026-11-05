"use client";
import { useState } from "react";
import { ArrowRight, Mail, Phone } from "./Icons";

type Status = "idle" | "loading" | "done" | "error";

export function SignupForm({ source, size = "lg" }: { source: string; size?: "lg" | "md" }) {
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setStatus("loading");
    setMsg("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source, company: form.get("company") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMsg((err as Error).message);
    }
  }

  if (status === "done") {
    return (
      <div className="card flex items-center gap-4 p-5" role="status">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">✓</span>
        <div>
          <p className="font-semibold">You&apos;re in.</p>
          <p className="text-[14px] text-muted">Watch your inbox before the bell. Your first alert is on its way.</p>
        </div>
      </div>
    );
  }

  const h = size === "lg" ? "h-14" : "h-12";
  return (
    <div className="w-full max-w-[520px]">
      <div role="tablist" aria-label="Alert channel" className="mb-3 inline-flex rounded-full border border-line bg-surface p-1 text-[13px]">
        <button type="button" role="tab" aria-selected={channel === "email"} onClick={() => setChannel("email")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors ${channel === "email" ? "bg-white/[0.07] text-ink" : "text-muted hover:text-ink"}`}>
          <Mail className="h-3.5 w-3.5" /> Email
        </button>
        <button type="button" role="tab" aria-selected={channel === "sms"} onClick={() => setChannel("sms")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors ${channel === "sms" ? "bg-white/[0.07] text-ink" : "text-muted hover:text-ink"}`}>
          <Phone className="h-3.5 w-3.5" /> SMS
          <span className="rounded-full bg-brand/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-brand">Soon</span>
        </button>
      </div>

      {channel === "email" ? (
        <form onSubmit={submit} className={`flex ${h} items-center gap-1.5 rounded-full border border-line-strong bg-surface p-1.5 pl-5 transition-colors focus-within:border-brand/60`}>
          <label htmlFor={`email-${source}`} className="sr-only">Email address</label>
          <input
            id={`email-${source}`} type="email" required autoComplete="email" inputMode="email"
            placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
          />
          {/* Honeypot */}
          <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          <button type="submit" disabled={status === "loading"} className="btn-primary !h-full shrink-0 !px-5">
            {status === "loading" ? "Joining…" : <>Get alerts free <ArrowRight /></>}
          </button>
        </form>
      ) : (
        <div className={`flex ${h} items-center justify-between gap-3 rounded-full border border-dashed border-line-strong bg-surface px-5 text-[14px] text-muted`}>
          <span>Text alerts are launching soon.</span>
          <button type="button" onClick={() => setChannel("email")} className="font-medium text-brand hover:underline">Use email for now</button>
        </div>
      )}

      <p className={`mt-3 text-[12.5px] ${status === "error" ? "text-down" : "text-faint"}`} aria-live="polite">
        {status === "error" ? msg : "Free forever. One-click unsubscribe. Not investment advice."}
      </p>
    </div>
  );
}
