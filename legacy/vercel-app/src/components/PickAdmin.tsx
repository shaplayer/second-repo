"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pct, upDown } from "@/lib/format";
import ChatAdmin from "./ChatAdmin";
import MemberAdmin from "./MemberAdmin";

type Row = {
  id: string;
  ticker: string;
  title: string;
  kind: "pick" | "sponsored";
  tier: "free" | "members";
  author: string;
  postedAt: string;
  closed: boolean;
  returnPct: number | null;
};

const blank = {
  kind: "pick" as "pick" | "sponsored",
  ticker: "",
  title: "",
  why: "",
  author: "",
  tier: "free" as "free" | "members",
  ownsShares: null as boolean | null,
  ownershipNote: "",
  payer: "",
  amount: "",
  form: "",
  email: true,
};

export default function PickAdmin({ picks }: { picks: Row[] }) {
  const router = useRouter();
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }));
  const sponsored = f.kind === "sponsored";

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg({});
    const res = await fetch("/api/admin/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: f.kind,
        ticker: f.ticker,
        title: f.title,
        why: f.why,
        author: f.author,
        tier: sponsored ? "free" : f.tier,
        ownsShares: f.ownsShares,
        ownershipNote: f.ownershipNote,
        sponsor: sponsored ? { payer: f.payer, amount: f.amount, form: f.form } : undefined,
        email: f.email,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ error: data.error });
    setMsg({ ok: `Published ${data.pick.ticker} at $${data.pick.priceAtPost.toFixed(2)}.${f.email ? ` Emailed ${data.emailed} subscriber(s).` : ""}` });
    setF(blank);
    router.refresh();
  };

  const close = async (id: string) => {
    if (!window.confirm("Close this pick? Its result will be frozen at today’s price. This can’t be undone.")) return;
    const res = await fetch("/api/admin/picks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) router.refresh();
    else setMsg({ error: (await res.json()).error });
  };

  return (
    <div className="two" style={{ paddingBlock: "24px 56px" }}>
      <section className="panel">
        <header>
          <h2>Post a pick</h2>
          <button className="linkish" onClick={async () => (await fetch("/api/admin/login", { method: "DELETE" }), router.refresh())}>
            Sign out
          </button>
        </header>
        <form className="modal-body" onSubmit={publish}>
          <div className="seg" role="radiogroup" aria-label="Type of post">
            <button type="button" aria-pressed={!sponsored} onClick={() => set("kind", "pick")}>
              BigStocks Pick
            </button>
            <button type="button" aria-pressed={sponsored} onClick={() => set("kind", "sponsored")}>
              Sponsored (paid)
            </button>
          </div>

          {sponsored && (
            <div className="ad-disclosure" style={{ display: "grid", gap: 8, fontWeight: 400 }}>
              <strong>Required by law for paid promotions</strong>
              <span className="small">
                Federal law requires every paid stock promotion to say who paid, how much, and whether in cash or shares. This is
                shown at the top of the post and email.
              </span>
              <label className="label" htmlFor="sp-payer">Who paid</label>
              <input id="sp-payer" className="field" placeholder="e.g. Acme Corp, or XYZ Media LLC on behalf of Acme Corp" value={f.payer} onChange={(e) => set("payer", e.target.value)} />
              <label className="label" htmlFor="sp-amount">How much</label>
              <input id="sp-amount" className="field" placeholder="e.g. $5,000, or 20,000 shares" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
              <label className="label" htmlFor="sp-form">Paid in</label>
              <input id="sp-form" className="field" placeholder="e.g. cash, or restricted shares" value={f.form} onChange={(e) => set("form", e.target.value)} />
            </div>
          )}

          <label className="label" htmlFor="pk-ticker">Stock</label>
          <input id="pk-ticker" className="field" placeholder="Ticker, e.g. AAPL" value={f.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} />
          <label className="label" htmlFor="pk-title">Headline</label>
          <input id="pk-title" className="field" placeholder="e.g. Sales are speeding up and the stock hasn’t caught up" value={f.title} onChange={(e) => set("title", e.target.value)} />
          <label className="label" htmlFor="pk-why">Why</label>
          <textarea id="pk-why" className="field" rows={5} placeholder="The reasons, in plain English." value={f.why} onChange={(e) => set("why", e.target.value)} />
          {!sponsored && (
            <>
              <label className="label" htmlFor="pk-author">Investor</label>
              <input id="pk-author" className="field" placeholder="Name shown on the pick" value={f.author} onChange={(e) => set("author", e.target.value)} />
              <span className="label">Who can see it</span>
              <div className="seg">
                <button type="button" aria-pressed={f.tier === "free"} onClick={() => set("tier", "free")}>Free, everyone</button>
                <button type="button" aria-pressed={f.tier === "members"} onClick={() => set("tier", "members")}>Members only</button>
              </div>
            </>
          )}

          <span className="label">Does the writer or BigStocks own this stock?</span>
          <div className="seg">
            <button type="button" aria-pressed={f.ownsShares === true} onClick={() => set("ownsShares", true)}>Yes</button>
            <button type="button" aria-pressed={f.ownsShares === false} onClick={() => set("ownsShares", false)}>No</button>
          </div>
          {f.ownsShares && (
            <input id="pk-own" className="field" placeholder="Optional detail, e.g. Owns 2,000 shares bought in March" value={f.ownershipNote} onChange={(e) => set("ownershipNote", e.target.value)} />
          )}

          <label className="opt">
            <input type="checkbox" id="pk-email" checked={f.email} onChange={(e) => set("email", e.target.checked)} />
            <span>Email it to subscribers who turned on pick alerts{!sponsored && f.tier === "members" ? " (members-only picks aren’t emailed yet)" : ""}</span>
          </label>
          {msg.error && <div className="form-error">{msg.error}</div>}
          {msg.ok && <div className="small up">{msg.ok}</div>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Publishing…" : "Publish at today’s price"}
          </button>
          <span className="disc">The price is recorded automatically when you publish. Picks can be closed but not deleted, so the track record stays honest.</span>
        </form>
      </section>

      <div className="col">
      <section className="panel">
        <header>
          <h2>Published</h2>
          <Link href="/picks" className="small">View public page</Link>
        </header>
        <div className="rows">
          {picks.length === 0 && <div className="empty">Nothing yet.</div>}
          {picks.map((p) => (
            <div key={p.id} className="row" style={{ gridTemplateColumns: "60px minmax(0,1fr) auto" }}>
              <span className="tick">{p.ticker}</span>
              <span className="small" style={{ minWidth: 0 }}>
                <strong style={{ display: "block" }}>{p.title}</strong>
                <span className="muted">
                  {p.kind === "sponsored" ? "Sponsored" : `${p.author} · ${p.tier === "members" ? "Members" : "Free"}`}
                  {p.closed ? " · Closed" : ""}
                </span>
              </span>
              <span style={{ display: "grid", justifyItems: "end", gap: 4 }}>
                <span className={`chg ${upDown(p.returnPct ?? 0)}`}>{p.returnPct !== null ? pct(p.returnPct) : "—"}</span>
                {!p.closed && (
                  <button className="linkish" onClick={() => close(p.id)}>
                    Close
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
      <MemberAdmin />
      <ChatAdmin />
      </div>
    </div>
  );
}
