"use client";

import { useId, useState } from "react";

/** Must match the list in app/api/inquiry/route.ts. */
const PACKAGES = ["Featured news", "Sponsored alert", "Campaign"] as const;

const EMPTY = { name: "", email: "", phone: "", company: "", ticker: "", package: PACKAGES[0] as string, message: "", website: "" };

const labelCls = "text-[13px] text-dark-muted";
const inputCls = "h-12 w-full min-w-0 rounded-xl border-0 bg-white px-3 text-base text-ink";

/**
 * The "Talk to us" form on the page for public companies. Posts to /api/inquiry, which saves the
 * message and emails the team. `website` is a field people never see: only scripts fill it in.
 */
export function InquiryForm() {
  const id = useId();
  const [values, setValues] = useState(EMPTY);
  const [state, setState] = useState<"idle" | "busy" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "busy") return;
    setState("busy");
    setMessage("");
    try {
      const res = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setState("error");
        setMessage(data.error ?? "That didn't go through. Please try again.");
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setMessage("We couldn't reach the server. Check your connection and try again.");
    }
  }

  if (state === "done") {
    return <p role="status" className="m-0 rounded-xl bg-white/10 px-4 py-3.5 text-base font-bold text-white">Thanks. We reply within one business day.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className={labelCls}>Your name</label>
          <input id={`${id}-name`} name="name" type="text" required autoComplete="name" value={values.name} onChange={set("name")} className={inputCls} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-email`} className={labelCls}>Email</label>
          <input id={`${id}-email`} name="email" type="email" required autoComplete="email" inputMode="email" value={values.email} onChange={set("email")} className={inputCls} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-phone`} className={labelCls}>Phone number (optional)</label>
          <input id={`${id}-phone`} name="phone" type="tel" autoComplete="tel" inputMode="tel" value={values.phone} onChange={set("phone")} className={inputCls} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-company`} className={labelCls}>Company</label>
          <input id={`${id}-company`} name="company" type="text" required autoComplete="organization" value={values.company} onChange={set("company")} className={inputCls} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-ticker`} className={labelCls}>Ticker (optional)</label>
          <input id={`${id}-ticker`} name="ticker" type="text" autoComplete="off" autoCapitalize="characters" maxLength={12} value={values.ticker} onChange={set("ticker")} className={inputCls} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-package`} className={labelCls}>Interested in</label>
          <select id={`${id}-package`} name="package" value={values.package} onChange={set("package")} className={`${inputCls} px-2.5`}>
            {PACKAGES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-message`} className={labelCls}>Anything else</label>
        <textarea id={`${id}-message`} name="message" rows={3} value={values.message} onChange={set("message")}
          className="min-h-[88px] w-full resize-y rounded-xl border-0 bg-white p-3 text-base text-ink" />
      </div>
      {/* Hidden from people and from screen readers. Stays empty unless a script fills it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={set("website")} />
      </div>
      {state === "error" && <p role="alert" className="m-0 rounded-xl bg-[#3a1512] px-4 py-3 text-sm leading-normal text-[#ffb4ab]">{message}</p>}
      <button type="submit" disabled={state === "busy"} className="btn btn-bright h-[50px] self-start rounded-[14px] px-6 text-base">
        {state === "busy" ? "Sending…" : "Send"}
      </button>
      <span className="text-xs text-dark-fine">We reply within one business day.</span>
    </form>
  );
}
