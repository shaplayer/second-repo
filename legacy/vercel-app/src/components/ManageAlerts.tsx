"use client";

import Link from "next/link";
import { useState } from "react";
import type { AlertPrefs } from "@/lib/store";
import AlertOptions from "./AlertOptions";

type Props = { token: string; email: string; tickers: string[]; prefs: AlertPrefs; askUnsubscribe: boolean };

export default function ManageAlerts({ token, email, tickers: initialTickers, prefs: initialPrefs, askUnsubscribe }: Props) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const [tickers, setTickers] = useState(initialTickers);
  const [msg, setMsg] = useState("");
  const [gone, setGone] = useState(false);

  const save = async () => {
    const res = await fetch("/api/alerts/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, prefs, tickers }),
    });
    setMsg(res.ok ? "Saved." : "Couldn't save. The link may have expired.");
  };

  const unsubscribe = async () => {
    const res = await fetch(`/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" });
    if (res.ok) setGone(true);
  };

  if (gone)
    return (
      <section className="panel">
        <div className="coming">
          <span className="label">Unsubscribed</span>
          <h2>You won’t get any more alerts</h2>
          <p className="muted" style={{ margin: 0 }}>
            Changed your mind? Open any stock and press “Get alerts.”
          </p>
          <Link href="/" className="btn primary">
            Back to BigStocks
          </Link>
        </div>
      </section>
    );

  return (
    <section className="panel">
      <header>
        <h2>Alert settings</h2>
        <span className="small muted">{email}</span>
      </header>
      <div className="modal-body">
        {askUnsubscribe && (
          <div className="err-box" style={{ marginTop: 0, display: "grid", gap: 8 }}>
            <strong>Stop all BigStocks alerts?</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" onClick={unsubscribe}>
                Yes, unsubscribe me
              </button>
              <span className="small muted" style={{ alignSelf: "center" }}>
                Or change your settings below instead.
              </span>
            </div>
          </div>
        )}
        <span className="label">Stocks you get alerts for</span>
        {tickers.length === 0 && <span className="muted">None. Open a stock and press “Get alerts” to add one.</span>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tickers.map((t) => (
            <span key={t} className="chip">
              <Link href={`/stock/${t}`} className="num">
                {t}
              </Link>
              <button aria-label={`Stop alerts for ${t}`} onClick={() => setTickers(tickers.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <AlertOptions prefs={prefs} onChange={setPrefs} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn primary" onClick={save}>
            Save settings
          </button>
          {msg && <span className="small muted">{msg}</span>}
        </div>
        {!askUnsubscribe && (
          <button className="btn" style={{ border: 0, justifySelf: "start", padding: 0, color: "var(--muted)" }} onClick={unsubscribe}>
            Unsubscribe from all alerts
          </button>
        )}
      </div>
    </section>
  );
}
