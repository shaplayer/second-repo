import Link from "next/link";
import { confirmSubscriber } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Confirm({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const s = await confirmSubscriber(token ?? "");
  const sub = s ? { tickers: s.tickers, mode: s.prefs.mode } : null;
  return (
    <section className="panel" style={{ maxWidth: 560, margin: "40px auto" }}>
      <div className="coming">
        {sub ? (
          <>
            <span className="label">Alerts are on</span>
            <h2>You’re all set</h2>
            <p style={{ margin: 0 }}>
              We’ll email you {sub.mode === "daily" ? "a daily summary at 6 PM ET" : "the minute"} {sub.tickers.join(", ")}{" "}
              {sub.tickers.length === 1 ? "files" : "file"} something new, explained in plain English.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href={`/alerts/manage?token=${token}`} className="btn">
                Alert settings
              </Link>
              <Link href="/" className="btn primary">
                Back to BigStocks
              </Link>
            </div>
          </>
        ) : (
          <>
            <span className="label">Link expired</span>
            <h2>We couldn’t find that sign-up</h2>
            <p className="muted" style={{ margin: 0 }}>
              It may have been canceled. Open any stock and press “Get alerts” to sign up again.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
