"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { SMS_CONSENT_TEXT, smsCombinedConsentText, smsFollowConsentText } from "@/lib/sms-consent";
import { ArrowRight, Check, Mail, Phone } from "./Icons";

/** Formats as (555) 123-4567 while typing. */
export function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

type Status = "idle" | "loading" | "done" | "error";
type Result = { picks?: boolean; follow?: "following" | "confirm"; sms?: boolean; email?: boolean };

async function post(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data as { status?: "following" | "confirm" };
}

/**
 * The one sign-up box used everywhere: email, plus "+ Also text me" for SMS.
 * With a `ticker`, it can also follow that company's press releases and SEC filings.
 *
 * layout="inline": email + button in one pill (hero, final CTA).
 * layout="stacked": full-width fields and button (bell pop-up, sidebars).
 */
export function AlertForm({
  source, ticker, layout = "inline", cta = "Get free alerts", picksDefault = true, onDone,
}: {
  source: string; ticker?: string; layout?: "inline" | "stacked"; cta?: string; picksDefault?: boolean;
  onDone?: () => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [follow, setFollow] = useState(true);
  const [picks, setPicks] = useState(ticker ? picksDefault : true);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<Result>({});

  const wantsFollow = Boolean(ticker) && follow;
  const wantsPicks = !ticker || picks;
  const hasPhone = phone.replace(/\D/g, "").length > 0;
  const nothingPicked = Boolean(ticker) && !follow && !picks;

  const consentText = !ticker || !wantsFollow
    ? SMS_CONSENT_TEXT
    : wantsPicks ? smsCombinedConsentText(ticker) : smsFollowConsentText(ticker);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (nothingPicked) { setStatus("error"); setMsg("Pick at least one: stock picks or company news."); return; }
    if (!email.trim() && !hasPhone) { setStatus("error"); setMsg("Enter your email or mobile number."); return; }
    if (hasPhone && !consent) { setStatus("error"); setMsg("Check the box to get alerts by text."); return; }
    const honeypot = new FormData(e.currentTarget).get("company");
    setStatus("loading");
    setMsg("");
    const r: Result = {};
    const combined = wantsFollow && wantsPicks ? { consent: "combined", ticker } : {};
    try {
      if (email.trim()) {
        if (wantsPicks) { await post("/api/subscribe", { channel: "email", email, source, company: honeypot }); r.picks = true; }
        if (wantsFollow) { const d = await post("/api/follow", { ticker, channel: "email", email, company: honeypot }); r.follow = d.status ?? "following"; }
        r.email = true;
      }
      if (hasPhone) {
        if (wantsPicks) { await post("/api/subscribe", { channel: "sms", phone, smsConsent: true, source, company: honeypot, ...combined }); r.picks = true; }
        if (wantsFollow) { await post("/api/follow", { ticker, channel: "sms", phone, smsConsent: true, company: honeypot, ...combined }); r.follow ??= "following"; }
        r.sms = true;
      }
      setResult(r);
      setStatus("done");
      onDone?.();
    } catch (err) {
      // Keep what already worked, so a retry doesn't look like nothing happened.
      if (r.email || r.picks || r.follow) setResult(r);
      setStatus("error");
      setMsg((err as Error).message);
    }
  }

  if (status === "done") {
    const where = [result.email && "inbox", result.sms && "phone"].filter(Boolean).join(" and ");
    return (
      <div className={`card flex w-full items-start gap-4 p-5 text-left ${layout === "inline" ? "max-w-[540px]" : ""}`} role="status">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand"><Check className="h-5 w-5" /></span>
        <div>
          <p className="font-semibold">You&apos;re in.</p>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            {result.follow === "confirm"
              ? `One last step: click the link we just emailed to start your $${ticker} news alerts.`
              : ticker && result.follow
                ? `$${ticker} press releases and SEC filings will hit your ${where} the moment they post.`
                : `Watch your ${where}. Picks land pre-market or at the open.`}
            {result.picks && ticker && result.follow ? " Free stock picks too." : ""}
          </p>
        </div>
      </div>
    );
  }

  const inline = layout === "inline";
  const input = "min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none";
  const row = `flex items-center gap-3 px-4 ${inline ? "h-14" : "h-12"}`;

  return (
    <form onSubmit={submit} className={`w-full text-left ${inline ? "max-w-[540px]" : ""}`} noValidate>
      {ticker && (
        <fieldset className="mb-4 grid gap-2">
          <legend className="sr-only">What do you want?</legend>
          <Choice checked={follow} onChange={setFollow}
            title={<><span className="font-mono">${ticker}</span> press releases &amp; SEC filings</>}
            sub="The second they post. Earnings, 8-Ks, offerings, FDA news." />
          <Choice checked={picks} onChange={setPicks}
            title="Free BigStocks stock picks"
            sub="Our winning alerts. Pre-market or at the open." />
        </fieldset>
      )}

      {/* Email and text live in one box: one sign-up, two ways to get it. Text is optional but recommended. */}
      <div className="overflow-hidden rounded-[22px] border border-line-strong bg-surface transition-colors focus-within:border-brand/60">
        <div className={row}>
          <Mail className="h-4 w-4 shrink-0 text-faint" />
          <label htmlFor={`${id}-email`} className="sr-only">Email address</label>
          <input id={`${id}-email`} type="email" autoComplete="email" inputMode="email" placeholder="you@email.com"
            required={!hasPhone} value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </div>
        <div className="mx-4 h-px bg-line" />
        <div className={row}>
          <Phone className="h-4 w-4 shrink-0 text-brand" />
          <span className="num text-[15px] text-faint" aria-hidden="true">+1</span>
          <label htmlFor={`${id}-phone`} className="sr-only">Mobile number for text alerts (US, recommended)</label>
          <input id={`${id}-phone`} type="tel" autoComplete="tel-national" inputMode="tel" placeholder="Mobile for text alerts"
            value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} className={`num ${input}`} />
          <span className="shrink-0 rounded-full bg-brand/12 px-2.5 py-1 text-[11px] font-semibold text-brand">Recommended</span>
        </div>
      </div>
      <p className="mt-2 px-1 text-[12.5px] text-muted">
        <span className="text-ink">Texts land in seconds,</span> straight to your phone. It&apos;s the fastest way to catch a pick.
      </p>

      {hasPhone && (
        <label className="mt-3 flex cursor-pointer gap-3 px-1 text-[11.5px] leading-relaxed text-faint">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#12e27a]" />
          <span>{consentText} <Link href="/sms-terms" className="text-muted underline underline-offset-2 hover:text-ink">SMS terms</Link></span>
        </label>
      )}

      <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <button type="submit" disabled={status === "loading"} className={`btn-primary mt-4 w-full ${inline ? "!h-[52px] !text-[16px]" : ""}`}>
        {status === "loading" ? "Joining…" : <>{cta} <ArrowRight /></>}
      </button>

      <p className={`mt-3 text-[12.5px] ${status === "error" ? "text-down" : "text-faint"}`} aria-live="polite">
        {status === "error" ? msg : "Free. Unsubscribe anytime. Text alerts for US numbers. Not investment advice."}
      </p>
    </form>
  );
}

function Choice({ checked, onChange, title, sub }: {
  checked: boolean; onChange: (v: boolean) => void; title: React.ReactNode; sub: string;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors ${checked ? "border-brand/40 bg-brand/[0.06]" : "border-line hover:border-line-strong"}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand ${checked ? "border-brand bg-brand text-[#04130b]" : "border-line-strong"}`}>
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
      <span>
        <span className="block text-[14.5px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-muted">{sub}</span>
      </span>
    </label>
  );
}
