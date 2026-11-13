"use client";

import { useId, useState } from "react";
import { consentFor } from "./consent";

type Props = {
  /** Follow this company as part of the sign-up. */
  cik?: number;
  ticker?: string | null;
  /** Which page or card the sign-up came from (kept with the consent record). */
  source: string;
  button: string;
  /** "dark" = on the dark sign-up card; "light" = inside a white card. */
  tone?: "dark" | "light";
  layout?: "row" | "stack";
  /** Join the free pick list too. Default true. */
  picks?: boolean;
  /** Add to a sign-up already waiting for its confirmation click. */
  batch?: string;
  onDone?: () => void;
};

/**
 * The email sign-up used across the site. Email only for now: the mobile field in the design is not
 * shown until text alerts are switched on (plan decision 15).
 * Nothing is sent to the address except one confirmation email until its link is clicked.
 */
export function SignupForm({ cik, ticker, source, button, tone = "dark", layout = "stack", picks = true, batch, onDone }: Props) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "busy") return;
    setState("busy");
    setMessage("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, cik, source, picks, batch }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; next?: string };
      if (!res.ok || !data.ok) {
        setState("error");
        setMessage(data.error ?? "That didn't go through. Please try again.");
        return;
      }
      if (onDone) {
        setState("idle");
        onDone();
      } else {
        window.location.assign(data.next ?? "/confirm");
      }
    } catch {
      setState("error");
      setMessage("We couldn't reach the server. Check your connection and try again.");
    }
  }

  const dark = tone === "dark";
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <div className={layout === "row" ? "flex flex-wrap gap-2 rounded-[20px] bg-white p-2" : "flex flex-col gap-2.5"}>
        <label htmlFor={`${id}-email`} className={layout === "row" ? "sr-only" : `text-[13px] ${dark ? "text-dark-muted" : "text-ink-2"}`}>Email</label>
        <input id={`${id}-email`} type="email" name="email" required autoComplete="email" inputMode="email" placeholder={layout === "row" ? "Email" : "you@email.com"}
          value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={`${id}-note`} aria-invalid={state === "error"}
          className={layout === "row"
            ? "h-[54px] min-w-0 flex-[1_1_220px] rounded-xl border-0 bg-field px-3.5 text-[17px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-brand"
            : `h-12 rounded-xl border-0 px-3.5 text-base text-ink ${dark ? "bg-white" : "bg-white shadow-[0_0_0_1px_#dfe9e3]"}`} />
        <button type="submit" disabled={state === "busy"}
          className={`btn ${dark ? "btn-bright" : "btn-brand"} ${layout === "row" ? "h-[54px] flex-[1_1_100%] rounded-[14px] text-base md:flex-[0_0_auto]" : "h-[50px] rounded-[14px] text-base font-extrabold"}`}>
          {state === "busy" ? "Sending…" : button}
        </button>
      </div>
      <p role={state === "error" ? "alert" : undefined} className={`m-0 text-xs leading-normal ${state === "error" ? (dark ? "text-[#ffb4ab]" : "text-bad") : dark ? "text-dark-fine" : "text-muted"}`} id={`${id}-note`}>
        {state === "error" ? message : consentFor(ticker, picks)}
      </p>
    </form>
  );
}
