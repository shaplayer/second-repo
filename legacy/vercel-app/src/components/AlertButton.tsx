"use client";

import { useEffect, useRef, useState } from "react";
import type { AlertPrefs } from "@/lib/store";
import AlertOptions from "./AlertOptions";

export default function AlertButton({ ticker }: { ticker: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [prefs, setPrefs] = useState<AlertPrefs>({ earnings: true, news: true, insider: false, picks: false, mode: "instant" });
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string }>({});

  useEffect(() => {
    try {
      setEmail(localStorage.getItem("bigstocks:email") ?? "");
    } catch {}
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const res = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ticker, prefs }),
      });
      const data = await res.json();
      if (!res.ok) return setState({ error: data.error ?? "Something went wrong. Try again." });
      try {
        localStorage.setItem("bigstocks:email", email);
      } catch {}
      setState({ done: data.message });
    } catch {
      setState({ error: "Couldn't reach BigStocks. Check your connection and try again." });
    }
  };

  return (
    <>
      <button className="btn primary" onClick={() => (setState({}), dialog.current?.showModal())}>
        🔔 Get alerts
      </button>
      <dialog ref={dialog} className="modal" onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
        {state.done ? (
          <div className="modal-body">
            <h2>Almost done</h2>
            <p style={{ margin: 0 }}>{state.done}</p>
            <p className="small muted" style={{ margin: 0 }}>
              Don’t see it? Check your spam folder.
            </p>
            <button className="btn primary" onClick={() => dialog.current?.close()}>
              OK
            </button>
          </div>
        ) : (
          <form className="modal-body" onSubmit={submit}>
            <h2>Alerts for {ticker}</h2>
            <p className="muted" style={{ margin: 0 }}>
              We email you a plain-English summary the minute {ticker} files something with the SEC. Free.
            </p>
            <label className="label" htmlFor="alert-email">
              Your email
            </label>
            <input
              id="alert-email"
              className="field"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <AlertOptions prefs={prefs} onChange={setPrefs} />
            {state.error && <div className="form-error">{state.error}</div>}
            <button className="btn primary" type="submit" disabled={state.busy}>
              {state.busy ? "Sending…" : "Turn on alerts"}
            </button>
            <button className="btn" type="button" style={{ border: 0 }} onClick={() => dialog.current?.close()}>
              Not now
            </button>
          </form>
        )}
      </dialog>
    </>
  );
}
