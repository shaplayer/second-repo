import PickCard from "@/components/PickCard";
import { getAccount } from "@/lib/account";
import { pct } from "@/lib/format";
import { picksWithResults, trackRecord } from "@/lib/picks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Picks · BigStocks" };

export default async function Picks() {
  const [results, me] = await Promise.all([picksWithResults(), getAccount().catch(() => null)]);
  const rec = trackRecord(results);
  const picks = results.filter((r) => r.kind === "pick");
  const sponsored = results.filter((r) => r.kind === "sponsored");

  return (
    <div style={{ display: "grid", gap: 20, paddingBlock: "24px 56px" }}>
      <div style={{ display: "grid", gap: 8, maxWidth: 680 }}>
        <span className="label">BigStocks Picks</span>
        <h1 style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 900 }}>Stock picks from our in-house investors</h1>
        <p className="muted" style={{ margin: 0 }}>
          Every pick is tracked automatically from the price on the day it was posted, next to the S&amp;P 500 over the same days.
          Winners and losers both stay on this page.
        </p>
      </div>

      <section className="panel">
        <header>
          <h2>Track record</h2>
          <span className="small muted">Picks only. Sponsored posts are ads and don’t count.</span>
        </header>
        <div className="stats">
          <div className="stat">
            <span className="label">Picks made</span>
            <span className="v">{rec.count}</span>
          </div>
          <div className="stat">
            <span className="label">Average result</span>
            <span className="v">{rec.avgReturn !== null ? pct(rec.avgReturn) : "—"}</span>
          </div>
          <div className="stat">
            <span className="label">Beat the S&amp;P 500</span>
            <span className="v">{rec.count ? `${rec.beatMarket} of ${rec.count}` : "—"}</span>
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 20 }}>Picks</h2>
        {picks.length === 0 && <div className="panel empty">No picks yet. The first one will appear here.</div>}
        <div className="pick-grid">
          {picks.map((p) => (
            <PickCard key={p.id} p={p} locked={p.tier === "members" && !me?.isMember} />
          ))}
        </div>
      </section>

      {sponsored.length > 0 && (
        <section style={{ display: "grid", gap: 12 }}>
          <h2 style={{ fontSize: 20 }}>Sponsored</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Companies or their promoters paid BigStocks to publish these. They are advertisements, not our investors’ opinions.
          </p>
          <div className="pick-grid">
            {sponsored.map((p) => (
              <PickCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}

      <p className="disc" style={{ margin: 0 }}>
        BigStocks is a publisher. Nothing here is personal investment advice, and BigStocks and its writers are not registered
        investment advisers. Past results don’t predict future results. You can lose money investing.
      </p>
    </div>
  );
}
