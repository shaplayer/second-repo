"use client";

import { useState } from "react";

/** Monthly/yearly choice and the button that opens Stripe checkout. */
export default function MembershipButtons({ signedIn, trial }: { signedIn: boolean; trial: boolean }) {
  const [interval, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const go = async () => {
    if (!signedIn) return (window.location.href = "/signin?next=/membership");
    setState({ busy: true });
    const res = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interval }) }).catch(() => null);
    const data = res ? await res.json() : { error: "Couldn’t reach BigStocks." };
    if (res?.ok && data.url) window.location.href = data.url;
    else setState({ error: data.error });
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="seg" role="radiogroup" aria-label="Billing">
        <button type="button" aria-pressed={interval === "monthly"} onClick={() => setBilling("monthly")}>
          Monthly · $49
        </button>
        <button type="button" aria-pressed={interval === "yearly"} onClick={() => setBilling("yearly")}>
          Yearly · $490 (2 months free)
        </button>
      </div>
      <button className="btn primary" style={{ padding: 13, fontSize: 16 }} onClick={go} disabled={state.busy}>
        {state.busy ? "Opening checkout…" : trial ? "Start 7-day free trial" : "Become a member"}
      </button>
      <span className="small muted">
        {trial
          ? `Free for 7 days, then ${interval === "yearly" ? "$490 a year" : "$49 a month"}. Cancel anytime before day 8 and you won’t be charged.`
          : `${interval === "yearly" ? "$490 a year" : "$49 a month"}. Cancel anytime.`}
      </span>
      {state.error && <div className="form-error">{state.error}</div>}
    </div>
  );
}
