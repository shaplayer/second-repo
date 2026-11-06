"use client";
import { useCallback, useEffect, useState } from "react";

type Tier = "free" | "premium";
type Channel = "email" | "sms";
type Audience = Record<Tier, Record<Channel, number>>;
type Broadcast = {
  id: string; ticker: string | null; tier: Tier; channels: Channel[]; status: string;
  emailsSent: number; textsSent: number; failed: number; error: string | null; createdAt: string; finishedAt: string | null;
};
type Setup = { db: boolean; email: { name: string; ready: boolean }; sms: { name: string; ready: boolean } };

const field = "h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint focus:border-brand/60 focus:outline-none";
const lbl = "mb-1.5 block text-[13px] font-medium text-muted";

export function AdminLogin() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) location.reload();
    else setErr((await r.json().catch(() => ({}))).error ?? "Couldn't sign in.");
  }
  return (
    <form onSubmit={go} className="card mx-auto max-w-sm p-7">
      <h1 className="text-[22px] font-semibold tracking-tight">Admin sign in</h1>
      <label htmlFor="pw" className={`${lbl} mt-5`}>Password</label>
      <input id="pw" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className={field} />
      {err && <p className="mt-3 text-[13px] text-down">{err}</p>}
      <button className="btn-primary mt-5 w-full">Sign in</button>
    </form>
  );
}

/** Send an alert: it's timestamped on the public track record and sent by text and email. */
export function AdminConsole({ setup }: { setup: Setup }) {
  const [f, setF] = useState({ ticker: "", price: "", tier: "free" as Tier, message: "", sponsored: false, sponsorComp: "", email: true, sms: true });
  const [testTo, setTestTo] = useState({ email: "", phone: "" });
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [list, setList] = useState<Broadcast[]>([]);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/alerts", { cache: "no-store" });
    if (r.status === 401) return location.reload();
    if (r.ok) { const d = await r.json(); setAudience(d.audience); setList(d.broadcasts); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 4000); return () => clearInterval(id); }, [load]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setStep("edit"); };
  const channels: Channel[] = [...(f.sms ? ["sms" as const] : []), ...(f.email ? ["email" as const] : [])];
  const ticker = f.ticker.trim().toUpperCase().replace(/^\$/, "");
  const price = Number(f.price);
  const valid = /^[A-Z]{1,5}(\.[A-Z])?$/.test(ticker) && price > 0 && channels.length > 0 && (!f.sponsored || f.sponsorComp.trim());
  const reach = audience ? (f.sms ? audience[f.tier].sms : 0) + (f.email ? audience[f.tier].email : 0) : null;
  const body = { ticker, price, tier: f.tier, message: f.message, sponsored: f.sponsored, sponsorComp: f.sponsorComp };

  async function send() {
    setBusy(true); setNote(null);
    const r = await fetch("/api/admin/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, channels }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setNote({ ok: false, text: d.error ?? "Couldn't send." }); return; }
    setNote({ ok: true, text: `$${ticker} logged on the track record and sending now.` });
    setF((x) => ({ ...x, ticker: "", price: "", message: "", sponsored: false, sponsorComp: "" }));
    setStep("edit");
    load();
  }
  async function test() {
    setBusy(true); setNote(null);
    const r = await fetch("/api/admin/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...testTo }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setNote(r.ok ? { ok: true, text: `Test sent by ${d.sent.join(" and ")}.` } : { ok: false, text: d.error ?? "Test failed." });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="card p-6 md:p-7">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Send an alert</h1>
          <button type="button" className="text-[13px] text-faint hover:text-ink"
            onClick={async () => { await fetch("/api/admin/login", { method: "DELETE" }); location.reload(); }}>Sign out</button>
        </div>
        <p className="mt-1.5 text-[13.5px] text-muted">Sending logs it on the public track record with the current time. Alerts can&apos;t be edited or deleted afterwards.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="t" className={lbl}>Ticker</label>
            <input id="t" value={f.ticker} onChange={(e) => set("ticker", e.target.value.slice(0, 8))} placeholder="NVDA" className={`${field} font-mono uppercase`} />
          </div>
          <div>
            <label htmlFor="p" className={lbl}>Alert price ($)</label>
            <input id="p" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="12.50" className={`${field} num`} />
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className={lbl}>Who gets it</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["free", "premium"] as const).map((t) => (
              <button key={t} type="button" onClick={() => set("tier", t)}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${f.tier === t ? "border-brand/60 bg-brand/10" : "border-line-strong hover:border-[#3a434a]"}`}>
                <span className="block text-[15px] font-semibold">{t === "free" ? "Free alert" : "Premium pick"}</span>
                <span className="block text-[12.5px] text-muted">{t === "free" ? "Everyone on the list" : "Premium members only"}</span>
              </button>
            ))}
          </div>
          {f.tier === "premium" && <p className="mt-2 text-[12.5px] text-faint">Hidden on the public track record until 4:00 PM ET today, then shown with a Premium label.</p>}
        </fieldset>

        <div className="mt-4">
          <label htmlFor="m" className={lbl}>Note (optional)</label>
          <textarea id="m" rows={3} value={f.message} onChange={(e) => set("message", e.target.value.slice(0, 1000))}
            placeholder="Why it's on our radar, levels to watch…" className={`${field} h-auto py-2.5`} />
          <p className="mt-1 text-[12px] text-faint">The text message uses the first 140 characters.</p>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-3 text-[14px]">
          <input type="checkbox" checked={f.sponsored} onChange={(e) => set("sponsored", e.target.checked)} className="h-4 w-4 accent-[#12e27a]" />
          Sponsored alert
        </label>
        {f.sponsored && (
          <div className="mt-2">
            <label htmlFor="sc" className={lbl}>Compensation disclosure (required, shown with the alert)</label>
            <input id="sc" value={f.sponsorComp} onChange={(e) => set("sponsorComp", e.target.value.slice(0, 500))}
              placeholder="BigStocks was paid $5,000 by XYZ Corp for this alert." className={field} />
          </div>
        )}

        <fieldset className="mt-5">
          <legend className={lbl}>Send by</legend>
          <div className="flex flex-wrap gap-4 text-[14px]">
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={f.sms} onChange={(e) => set("sms", e.target.checked)} className="h-4 w-4 accent-[#12e27a]" /> Text {audience && <span className="num text-faint">({audience[f.tier].sms.toLocaleString()})</span>}</label>
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={f.email} onChange={(e) => set("email", e.target.checked)} className="h-4 w-4 accent-[#12e27a]" /> Email {audience && <span className="num text-faint">({audience[f.tier].email.toLocaleString()})</span>}</label>
          </div>
        </fieldset>

        <div className="mt-6 rounded-xl border border-line bg-bg/60 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">Send yourself a test first</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input value={testTo.email} onChange={(e) => setTestTo((x) => ({ ...x, email: e.target.value }))} placeholder="you@bigstocks.com" className={`${field} !h-10 !text-[14px]`} />
            <input value={testTo.phone} onChange={(e) => setTestTo((x) => ({ ...x, phone: e.target.value }))} placeholder="Your mobile" className={`${field} !h-10 !text-[14px]`} />
            <button type="button" disabled={busy || !valid} onClick={test} className="btn-ghost !h-10">Send test</button>
          </div>
        </div>

        {step === "edit" ? (
          <button type="button" disabled={!valid || busy} onClick={() => setStep("review")} className="btn-primary mt-6 w-full">Review alert</button>
        ) : (
          <div className="mt-6 rounded-xl border border-brand/40 bg-brand/[0.06] p-4">
            <p className="text-[15px]">
              Send <span className="font-mono font-semibold">${ticker}</span> at <span className="num font-semibold">${price.toFixed(2)}</span> as a{" "}
              <strong>{f.tier === "premium" ? "Premium pick" : "free alert"}</strong> by {channels.map((c) => (c === "sms" ? "text" : "email")).join(" + ")}
              {reach != null && <> to about <span className="num font-semibold">{reach.toLocaleString()}</span> {reach === 1 ? "person" : "people"}</>}?
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={busy} onClick={send} className="btn-primary flex-1">{busy ? "Sending…" : "Send now"}</button>
              <button type="button" disabled={busy} onClick={() => setStep("edit")} className="btn-ghost !h-12">Back</button>
            </div>
          </div>
        )}
        {note && <p className={`mt-4 text-[14px] ${note.ok ? "text-brand" : "text-down"}`} role="status">{note.text}</p>}
      </section>

      <section className="space-y-6">
        <div className="card p-6">
          <h2 className="text-[16px] font-semibold">Setup</h2>
          <ul className="mt-3 space-y-2 text-[14px]">
            <Status ok={setup.db} label="Database" hint="DATABASE_URL" />
            <Status ok={setup.email.ready} label={`Email (${setup.email.name})`} hint="EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM" />
            <Status ok={setup.sms.ready} label={`Text (${setup.sms.name})`} hint="SMS_PROVIDER + its keys" />
          </ul>
          {(!setup.email.ready || !setup.sms.ready) && <p className="mt-3 text-[12.5px] text-faint">&quot;console&quot; means messages are printed in the server log instead of sent. Fine for testing.</p>}
        </div>

        <div className="card overflow-hidden">
          <h2 className="border-b border-line px-6 py-4 text-[16px] font-semibold">Recent sends</h2>
          {list.length === 0 ? <p className="px-6 py-8 text-center text-[14px] text-muted">Nothing sent yet.</p> : (
            <ul className="divide-y divide-line">
              {list.map((b) => (
                <li key={b.id} className="px-6 py-3.5 text-[13.5px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono font-semibold">${b.ticker}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${b.status === "done" ? "bg-brand/15 text-brand" : b.status === "failed" ? "bg-down/15 text-down" : "bg-white/10 text-ink"}`}>{b.status}</span>
                  </div>
                  <p className="num mt-1 text-faint">
                    {b.tier === "premium" ? "Premium" : "Free"} · {new Date(b.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET
                    · {b.textsSent.toLocaleString()} text{b.textsSent === 1 ? "" : "s"} · {b.emailsSent.toLocaleString()} email{b.emailsSent === 1 ? "" : "s"}{b.failed ? ` · ${b.failed} failed` : ""}
                  </p>
                  {b.error && <p className="mt-1 text-[12.5px] text-down">{b.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Status({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-brand" : "bg-[#f5b84b]"}`} />
      <span>{label}{!ok && <span className="block text-[12px] text-faint">Set {hint}</span>}</span>
    </li>
  );
}
