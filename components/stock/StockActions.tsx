"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** "+ My stocks": one click when signed in; otherwise it leads to sign-in and back. */
export function FollowButton({ cik, ticker, signedIn, inList }: { cik: number; ticker: string | null; signedIn: boolean; inList: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(inList);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (!signedIn) {
      router.push(`/sign-in?next=${encodeURIComponent(`/stock/${ticker ?? `CIK${cik}`}`)}`);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/follow", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(on ? { cik, remove: true } : { cik, alerts: true, source: `stock:${ticker ?? cik}` }),
    }).catch(() => null);
    if (res?.ok) {
      setOn(!on);
      router.refresh();
    }
    setBusy(false);
  }
  return (
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={on} className={`btn btn-lg ${on ? "btn-soft" : "btn-outline"} min-h-12 text-[15px] font-bold`}>
      {on ? "In My stocks ✓" : "+ My stocks"}
    </button>
  );
}

/**
 * Shown the first time anyone opens a company's page: the worker is reading the SEC's record of it.
 * Asks every few seconds and reloads the page's data when it is ready.
 */
export function Gathering({ cik }: { cik: number }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let n = 0;
    const t = setInterval(async () => {
      n++;
      if (n > 20) setSlow(true);
      try {
        const res = await fetch(`/api/company-status?cik=${cik}`);
        const data = await res.json();
        if (data.profileReady && data.factsReady) {
          clearInterval(t);
          router.refresh();
        } else if (data.profileReady && n % 3 === 0) router.refresh();
      } catch {
        /* keep trying */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [cik, router]);
  return (
    <p role="status" className="card-mint m-0 px-5 py-4 text-[15px] leading-normal text-ink-2">
      {slow
        ? "This is taking longer than usual. The page fills in by itself as soon as the filings arrive."
        : "First visit to this company: we're gathering its SEC filings and health check. It takes a few seconds, and the page updates by itself."}
    </p>
  );
}
