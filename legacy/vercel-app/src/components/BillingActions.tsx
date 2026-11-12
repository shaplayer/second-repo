"use client";

import { useEffect, useState } from "react";

/** On return from Stripe, refresh membership; "Manage billing" opens Stripe's portal. */
export default function BillingActions({ syncNow, hasBilling }: { syncNow: boolean; hasBilling: boolean }) {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!syncNow) return;
    setMsg("Updating your membership…");
    fetch("/api/billing/sync", { method: "POST" })
      .then(() => {
        window.location.replace("/account");
      })
      .catch(() => setMsg("Couldn’t update yet. Refresh in a minute."));
  }, [syncNow]);
  if (msg) return <span className="small muted">{msg}</span>;
  if (!hasBilling) return null;
  return (
    <button
      className="btn"
      onClick={async () => {
        const res = await fetch("/api/billing/portal", { method: "POST" });
        const data = await res.json();
        if (data.url) window.location.href = data.url;
        else setMsg(data.error ?? "Couldn’t open billing.");
      }}
    >
      Manage billing
    </button>
  );
}
