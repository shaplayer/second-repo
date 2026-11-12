import Link from "next/link";
import { pickDisclosures } from "@/lib/email";
import { money, pct, upDown } from "@/lib/format";
import type { PickResult } from "@/lib/picks";
import { fmtWhen } from "@/lib/time";

/** One pick with its result and required disclosures. Members-only picks stay locked until member sign-in exists. */
export default function PickCard({ p, locked = false }: { p: PickResult; locked?: boolean }) {
  const sponsored = p.kind === "sponsored";
  const disc = pickDisclosures(p);
  if (locked)
    return (
      <article className="pick locked">
        <span className="pick-kind">BigStocks Pick · Members only</span>
        <strong>A new pick from {p.author}</strong>
        <span className="small muted">Posted {fmtWhen(new Date(p.postedAt))}.</span>
        <Link href="/membership" className="small">
          Members see every pick. See membership
        </Link>
      </article>
    );
  return (
    <article className={`pick ${sponsored ? "sponsored" : ""}`}>
      <span className="pick-kind">{sponsored ? "Advertisement · Sponsored" : p.tier === "members" ? "BigStocks Pick · Members" : "BigStocks Pick"}</span>
      {sponsored && <div className="ad-disclosure">{disc[0]}</div>}
      <div className="pick-head">
        <Link href={`/stock/${p.ticker}`} className="tick">
          {p.ticker}
        </Link>
        <span className="small muted">{p.companyName}</span>
      </div>
      <strong className="pick-title">{p.title}</strong>
      <p className="pick-why">{p.why}</p>
      <div className="pick-stats">
        <div>
          <span className="label">When posted</span>
          <span className="num">{money(p.priceAtPost)}</span>
          <span className="small muted">{fmtWhen(new Date(p.postedAt))}</span>
        </div>
        <div>
          <span className="label">{p.closedAt ? "When closed" : "Now"}</span>
          <span className="num">{p.priceNow !== null ? money(p.priceNow) : "—"}</span>
          {p.closedAt && <span className="small muted">{fmtWhen(new Date(p.closedAt))}</span>}
        </div>
        <div>
          <span className="label">Result</span>
          <span className={`num ${p.returnPct !== null ? upDown(p.returnPct) : ""}`}>{p.returnPct !== null ? pct(p.returnPct) : "—"}</span>
          <span className="small muted">S&amp;P 500: {p.sp500Pct !== null ? pct(p.sp500Pct) : "—"}</span>
        </div>
      </div>
      <span className="small muted">By {p.author}</span>
      <ul className="pick-disc">
        {disc.slice(sponsored ? 1 : 0).map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </article>
  );
}
