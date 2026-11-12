"use client";

import type { AlertPrefs } from "@/lib/store";

/** The checkboxes shared by the sign-up dialog and the settings page. */
export default function AlertOptions({ prefs, onChange }: { prefs: AlertPrefs; onChange: (p: AlertPrefs) => void }) {
  const box = (key: "earnings" | "news" | "insider", title: string, detail: string) => (
    <label className="opt">
      <input type="checkbox" id={`pref-${key}`} checked={prefs[key]} onChange={(e) => onChange({ ...prefs, [key]: e.target.checked })} />
      <span>
        <strong>{title}</strong>
        <br />
        <span className="small muted">{detail}</span>
      </span>
    </label>
  );
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span className="label">What to send</span>
      {box("earnings", "Earnings and reports", "Results, quarterly and yearly reports")}
      {box("news", "Company news", "Deals, leadership changes, new shares, other announcements")}
      {box("insider", "Insider trades", "Executives and directors buying or selling")}
      <label className="opt">
        <input type="checkbox" id="pref-picks" checked={!!prefs.picks} onChange={(e) => onChange({ ...prefs, picks: e.target.checked })} />
        <span>
          <strong>BigStocks Picks</strong>
          <br />
          <span className="small muted">New picks from our investors, plus clearly labeled sponsored posts</span>
        </span>
      </label>
      <span className="label" style={{ marginTop: 6 }}>
        When
      </span>
      <div className="seg" role="radiogroup" aria-label="When to send alerts">
        <button type="button" role="radio" aria-checked={prefs.mode === "instant"} aria-pressed={prefs.mode === "instant"} onClick={() => onChange({ ...prefs, mode: "instant" })}>
          The minute it happens
        </button>
        <button type="button" role="radio" aria-checked={prefs.mode === "daily"} aria-pressed={prefs.mode === "daily"} onClick={() => onChange({ ...prefs, mode: "daily" })}>
          One summary a day (6 PM ET)
        </button>
      </div>
      <label className="opt" style={{ opacity: 0.6 }}>
        <input type="checkbox" id="pref-sms" disabled />
        <span>
          <strong>Text messages</strong> <span className="soon">SOON</span>
          <br />
          <span className="small muted">Coming after phone carriers approve our number</span>
        </span>
      </label>
    </div>
  );
}
