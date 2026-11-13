"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignupForm } from "@/components/signup/SignupForm";

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ...data, ok: res.ok && data.ok !== false };
  } catch {
    return { ok: false, error: "We couldn't reach the server. Check your connection and try again." };
  }
}

/** "Email me a sign-in link." */
export function SignInForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  if (state === "sent") {
    return (
      <div role="status" className="card-mint flex flex-col gap-2 p-5">
        <strong className="text-lg">Check your inbox</strong>
        <p className="m-0 text-[15px] leading-normal text-ink-2">
          We sent a sign-in link to {email}. It works once and expires in 15 minutes. Not there? Check Spam or Promotions.
        </p>
        <button type="button" className="btn btn-soft self-start" onClick={() => setState("idle")}>Use a different address</button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-2.5" noValidate onSubmit={async (e) => {
      e.preventDefault();
      setState("busy");
      const r = await post("/api/auth/request", { email, next });
      if (r.ok) setState("sent");
      else {
        setState("error");
        setMessage(r.error ?? "That didn't go through. Please try again.");
      }
    }}>
      <label htmlFor="si-email" className="text-sm font-bold">Email</label>
      <input id="si-email" type="email" required autoComplete="email" inputMode="email" placeholder="you@email.com" value={email}
        onChange={(e) => setEmail(e.target.value)} className="field h-[52px] text-[17px]" aria-invalid={state === "error"} aria-describedby="si-note" />
      <button type="submit" disabled={state === "busy"} className="btn btn-brand btn-lg h-[52px] rounded-[14px]">
        {state === "busy" ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p id="si-note" role={state === "error" ? "alert" : undefined} className={`m-0 text-[13px] ${state === "error" ? "text-bad" : "text-muted"}`}>
        {state === "error" ? message : "The link works once and expires in 15 minutes."}
      </p>
    </form>
  );
}

/** On the check-your-inbox page: send the email again, and add more stocks to the same confirmation. */
export function ConfirmWait({ batch, email, popular }: { batch: string; email: string; popular: { cik: number; ticker: string }[] }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [ticker, setTicker] = useState("");
  const [addNote, setAddNote] = useState("");

  async function add(cik: number | null, t?: string) {
    setAddNote("");
    let target = cik;
    let symbol = t;
    if (target === null && t) {
      const found = await fetch(`/api/search?q=${encodeURIComponent(t)}`).then((r) => r.json()).catch(() => ({ companies: [] }));
      const hit = (found.companies ?? [])[0];
      if (!hit) return setAddNote(`We couldn't find “${t}”. Try the ticker, like AAPL.`);
      target = hit.cik;
      symbol = hit.ticker;
    }
    if (target === null) return;
    const r = await post("/api/subscribe", { email, cik: target, picks: false, batch, source: "confirm-page" });
    if (r.ok) {
      setAdded((s) => new Set(s).add(target!));
      setTicker("");
      setAddNote(`Added ${symbol ? `$${symbol}` : "it"}. One click on the email confirms everything.`);
    } else setAddNote(r.error ?? "That didn't go through.");
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" className="btn btn-soft" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await post("/api/confirm/resend", {});
          setNote(r.ok ? (r.done ? "You're already confirmed." : "Sent again. Give it a minute.") : r.error ?? "We couldn't send it just now.");
          setBusy(false);
        }}>
          {busy ? "Sending…" : "Resend email"}
        </button>
        <span role="status" className="text-sm text-ink-2">{note || "Not there? Check Promotions or Spam."}</span>
      </div>

      <section aria-labelledby="cf-more" className="card flex flex-col gap-3 p-5 md:p-6">
        <h2 id="cf-more" className="m-0 text-xl font-extrabold">While you wait: follow a few stocks</h2>
        <p className="m-0 text-[15px] text-ink-2">You&apos;ll get their press releases and SEC filings the moment they post.</p>
        {popular.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {popular.map((p) => (
              <button key={p.cik} type="button" disabled={added.has(p.cik)} onClick={() => add(p.cik, p.ticker)}
                className={`btn ${added.has(p.cik) ? "btn-soft" : "btn-outline"}`}>
                {added.has(p.cik) ? `$${p.ticker} ✓` : `+ $${p.ticker}`}
              </button>
            ))}
          </div>
        )}
        <form className="flex max-w-[420px] gap-2" onSubmit={(e) => { e.preventDefault(); if (ticker.trim()) add(null, ticker.trim()); }}>
          <label htmlFor="cf-add" className="sr-only">Add any stock</label>
          <input id="cf-add" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Add any stock" className="field" autoComplete="off" />
          <button type="submit" className="btn btn-brand h-12 rounded-xl px-5">Add</button>
        </form>
        <span role="status" className="text-sm text-ink-2">{addNote}</span>
      </section>
    </>
  );
}

type Option = { scope: "this" | "stocks" | "picks" | "all"; title: string; detail: string };

/** The unsubscribe page: choose what to stop, confirm, and an undo for a change of mind. */
export function UnsubscribeForm({ token, options }: { token: string; options: Option[] }) {
  const [scope, setScope] = useState<Option["scope"]>(options[0].scope);
  const [state, setState] = useState<"idle" | "busy" | "done" | "undone">("idle");
  const [undo, setUndo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const chosen = options.find((o) => o.scope === scope)!;

  if (state === "done" || state === "undone") {
    return (
      <div role="status" className="flex flex-col items-center gap-4 text-center">
        <h2 className="m-0 text-[28px] font-extrabold tracking-[-0.02em]">
          {state === "done" ? `Done. ${chosen.title.replace(/^Stop /, "Stopped ").replace(/^Unsubscribe from /, "Unsubscribed from ")}.` : "You're back on. Nothing was lost."}
        </h2>
        <p className="m-0 text-base text-ink-2">{state === "done" ? "It takes effect right away. Sorry to see you go." : "Your alerts are on again, exactly as before."}</p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {state === "done" && undo && (
            <button type="button" className="btn btn-outline btn-lg" onClick={async () => {
              const r = await post("/api/unsubscribe", { undo });
              if (r.ok && Number(r.restored) > 0) setState("undone");
              else setError("We couldn't undo that. Sign up again from any page.");
            }}>Undo, resubscribe</button>
          )}
          <Link href="/news" className="btn btn-dark btn-lg">Go to live news</Link>
        </div>
        {error && <p role="alert" className="m-0 text-sm text-bad">{error}</p>}
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setState("busy");
      const r = await post("/api/unsubscribe", { token, scope });
      if (r.ok) {
        setUndo(typeof r.undo === "string" ? r.undo : null);
        setState("done");
      } else {
        setState("idle");
        setError(r.error ?? "That didn't go through. Please try again.");
      }
    }}>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-bold">What to stop</legend>
        {options.map((o) => (
          <label key={o.scope} className={`flex cursor-pointer items-start gap-3 rounded-2xl p-4 ${scope === o.scope ? "bg-mint shadow-[0_0_0_2px_#0f9a55]" : "bg-white shadow-[0_0_0_1px_#e3ebe6]"}`}>
            <input type="radio" name="scope" value={o.scope} checked={scope === o.scope} onChange={() => setScope(o.scope)} className="mt-1 h-[18px] w-[18px] accent-brand" />
            <span className="flex flex-col gap-0.5"><strong className="text-base">{o.title}</strong><span className="text-sm text-ink-2">{o.detail}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button type="submit" disabled={state === "busy"} className="btn btn-dark btn-lg">{state === "busy" ? "Stopping…" : "Confirm"}</button>
        <Link href="/" className="text-[15px] font-bold no-underline">Keep my alerts</Link>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-bad">{error}</p>}
    </form>
  );
}

/** One stock card's switches on My stocks, and the add-a-stock box. */
export function StockAlertToggle({ cik, on }: { cik: number; on: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" aria-pressed={value} disabled={busy}
      className={`h-10 rounded-full px-4 text-[13px] font-extrabold ${value ? "border-0 bg-ink text-white" : "border border-dashed border-[#b8c6be] bg-white text-muted"}`}
      onClick={async () => {
        setBusy(true);
        const r = await post("/api/follow", { cik, only: "alerts", alerts: !value });
        if (r.ok) {
          setValue(!value);
          router.refresh();
        }
        setBusy(false);
      }}>
      Email {value ? "on" : "off"}
    </button>
  );
}

export function RemoveStock({ cik, label }: { cik: number; label: string }) {
  const router = useRouter();
  return (
    <button type="button" aria-label={`Remove ${label}`} className="ml-auto h-10 rounded-full border-0 bg-transparent px-3 text-[13px] font-bold text-muted hover:text-ink"
      onClick={async () => {
        const r = await post("/api/follow", { cik, remove: true });
        if (r.ok) router.refresh();
      }}>
      Remove
    </button>
  );
}

export function AddStock() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  return (
    <form className="flex flex-col gap-1.5" onSubmit={async (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      const found = await fetch(`/api/search?q=${encodeURIComponent(text.trim())}`).then((r) => r.json()).catch(() => ({ companies: [] }));
      const hit = (found.companies ?? [])[0];
      if (!hit) return setNote(`We couldn't find “${text.trim()}”. Try the ticker, like AAPL.`);
      const r = await post("/api/follow", { cik: hit.cik, alerts: true, source: "my-stocks" });
      if (r.ok) {
        setText("");
        setNote(`Added ${hit.ticker ? `$${hit.ticker}` : hit.name}, with email alerts on.`);
        router.refresh();
      } else setNote(r.error ?? "That didn't go through.");
    }}>
      <div className="flex gap-2 rounded-2xl bg-white p-1.5 shadow-[0_0_0_1px_#dfe9e3]">
        <label htmlFor="ms-add" className="sr-only">Add a stock</label>
        <input id="ms-add" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a stock: ticker or name" autoComplete="off"
          className="h-[46px] min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[15px] outline-none" />
        <button type="submit" className="btn btn-brand h-[46px] rounded-xl px-[18px] font-extrabold">Add</button>
      </div>
      <span role="status" className="min-h-5 text-[13px] text-ink-2">{note}</span>
    </form>
  );
}

/** A switch on the settings page that saves as soon as it is pressed. */
export function SettingSwitch({ label, on, setting, onLabel = "On", offLabel = "Off" }: {
  label: string; on: boolean;
  /** "picks" for the free pick list, otherwise the kind of news (press, earnings, …). */
  setting: string;
  onLabel?: string; offLabel?: string;
}) {
  const router = useRouter();
  const body = (next: boolean) => (setting === "picks" ? { picks: next } : { category: setting, on: next });
  const [value, setValue] = useState(on);
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} disabled={busy} title={value ? onLabel : offLabel}
      className={`flex h-8 w-[52px] flex-none rounded-2xl border-0 p-[3px] ${value ? "justify-end bg-brand" : "justify-start bg-[#cfd8d3]"}`}
      onClick={async () => {
        setBusy(true);
        const r = await post("/api/settings", body(!value));
        if (r.ok) {
          setValue(!value);
          router.refresh();
        }
        setBusy(false);
      }}>
      <span className="block h-[26px] w-[26px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]" />
    </button>
  );
}

export function CadenceChoice({ value }: { value: "instant" | "digest" }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const opt = (key: "instant" | "digest", label: string) => (
    <button type="button" aria-pressed={v === key} className={`btn ${v === key ? "btn-dark" : "btn-soft"}`}
      onClick={async () => {
        const r = await post("/api/settings", { cadence: key });
        if (r.ok) {
          setV(key);
          router.refresh();
        }
      }}>
      {label}
    </button>
  );
  return <div className="flex flex-wrap gap-2">{opt("instant", "As it happens")}{opt("digest", "One daily summary")}</div>;
}

export function StopEverything() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "ask" | "done">("idle");
  if (state === "done") return <span role="status" className="text-sm font-bold">Done. You won&apos;t get any more email from us.</span>;
  if (state === "ask") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn bg-bad text-white" onClick={async () => {
          const r = await post("/api/settings", { stopAll: true });
          if (r.ok) {
            setState("done");
            router.refresh();
          }
        }}>Yes, stop everything</button>
        <button type="button" className="btn btn-soft" onClick={() => setState("idle")}>Keep my alerts</button>
      </span>
    );
  }
  return <button type="button" className="btn btn-outline" onClick={() => setState("ask")}>Unsubscribe from all</button>;
}

export { SignupForm };
