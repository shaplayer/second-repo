"use client";
import { useEffect, useState } from "react";
import { PACKAGES, formatUSD } from "@/lib/advertise";
import { ArrowRight } from "./Icons";

const field =
  "h-12 w-full rounded-xl border border-line-strong bg-bg/60 px-4 text-[15px] text-ink placeholder:text-faint transition-colors focus:border-brand/60 focus:outline-none";
const label = "mb-1.5 block text-[13px] font-medium text-muted";

const PICK_EVENT = "bs:pick-package";

/** "Choose …" button: scrolls to the form and pre-selects the package. */
export function ChoosePackage({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  return (
    <a href="#contact" className={className}
      onClick={() => window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: id }))}>
      {children}
    </a>
  );
}

export function InquiryForm() {
  const [pkg, setPkg] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  // Pre-select a package from ?package=... or a "Choose" button on this page.
  useEffect(() => {
    const valid = (id: string | null) => (id && PACKAGES.some((p) => p.id === id) ? id : null);
    const fromUrl = valid(new URLSearchParams(window.location.search).get("package"));
    if (fromUrl) setPkg(fromUrl);
    const on = (e: Event) => { const id = valid((e as CustomEvent<string>).detail); if (id) setPkg(id); };
    window.addEventListener(PICK_EVENT, on);
    return () => window.removeEventListener(PICK_EVENT, on);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setMsg("");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch("/api/inquiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      <div className="flex min-h-[420px] flex-col items-center justify-center text-center" role="status">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/15 text-[22px] text-brand">✓</span>
        <h3 className="mt-5 text-[22px] font-semibold">Thanks, we&apos;ve got it.</h3>
        <p className="mt-2 max-w-sm text-[15px] text-muted">Our team will reach out shortly to plan your campaign.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor="iq-name" className={label}>Your name</label>
        <input id="iq-name" name="name" required autoComplete="name" className={field} placeholder="Jane Smith" />
      </div>
      <div>
        <label htmlFor="iq-company" className={label}>Company</label>
        <input id="iq-company" name="company" required autoComplete="organization" className={field} placeholder="Acme Corp." />
      </div>
      <div>
        <label htmlFor="iq-email" className={label}>Work email</label>
        <input id="iq-email" name="email" type="email" required autoComplete="email" className={field} placeholder="jane@acme.com" />
      </div>
      <div>
        <label htmlFor="iq-phone" className={label}>Phone <span className="text-faint">(optional)</span></label>
        <input id="iq-phone" name="phone" type="tel" autoComplete="tel" className={field} placeholder="(555) 123-4567" />
      </div>
      <div>
        <label htmlFor="iq-ticker" className={label}>Ticker <span className="text-faint">(optional)</span></label>
        <input id="iq-ticker" name="ticker" className={`${field} font-mono uppercase placeholder:font-sans placeholder:normal-case`} placeholder="e.g. ACME" maxLength={12} />
      </div>
      <div>
        <label htmlFor="iq-package" className={label}>Package</label>
        <select id="iq-package" name="package" value={pkg} onChange={(e) => setPkg(e.target.value)} className={`${field} appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238b949a%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10`}>
          <option value="">Not sure yet</option>
          {PACKAGES.map((p) => <option key={p.id} value={p.id}>{p.name}: {formatUSD(p.price)} {p.cadence}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="iq-message" className={label}>Anything we should know? <span className="text-faint">(optional)</span></label>
        <textarea id="iq-message" name="message" rows={4} className={`${field} h-auto resize-y py-3`} placeholder="Upcoming news, timing, goals…" />
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <div className="flex flex-col items-start gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-[12.5px] ${status === "error" ? "text-down" : "text-faint"}`} aria-live="polite">
          {status === "error" ? msg : "Our team will follow up with next steps. All sponsored placements are disclosed."}
        </p>
        <button type="submit" disabled={status === "loading"} className="btn-primary shrink-0">
          {status === "loading" ? "Sending…" : <>Request a campaign <ArrowRight /></>}
        </button>
      </div>
    </form>
  );
}
