import Link from "next/link";
import { HealthPill } from "@/components/ui/Badges";
import type { Snapshot } from "@/lib/data/companies";
import { dayET } from "@/lib/time";

const TINT: Record<string, string> = {
  Strong: "bg-mint shadow-[0_0_0_1px_#d6ece0]",
  Mixed: "bg-[#fffaf0] shadow-[0_0_0_1px_#f2e2bf]",
  Weak: "bg-[#fff6f5] shadow-[0_0_0_1px_#f4d6d2]",
};
const RANGE: Record<string, string> = { Strong: "Strong is 75% or more", Mixed: "Mixed is 50–74%", Weak: "Weak is under 50%" };

/**
 * The health check: Strong, Mixed or Weak, from the company's own SEC filings only. It describes the
 * business, never the stock, and never says Buy or Sell.
 */
export function HealthCard({ snapshot, waiting = false }: { snapshot: Snapshot | null; waiting?: boolean }) {
  const h = snapshot?.health;
  const verdict = snapshot?.verdict ?? null;
  const percent = h && h.answered > 0 ? Math.round((h.passed / h.answered) * 100) : null;
  const latest = h?.quarters?.[h.quarters.length - 1]?.filed ?? snapshot?.sourceFiled ?? null;
  return (
    <section aria-labelledby="health-h" className={`flex min-w-0 flex-[1_1_300px] flex-col gap-2.5 rounded-3xl p-[22px] ${verdict ? TINT[verdict] : "bg-inset shadow-[0_0_0_1px_#e3ebe6]"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="health-h" className="m-0 text-base font-extrabold">Health check</h2>
        {snapshot && <HealthPill verdict={verdict} className="px-3.5 text-sm" />}
      </div>
      {!snapshot || !h ? (
        <p className="m-0 text-sm leading-normal text-ink-2">
          {waiting ? "Reading this company's SEC filings. The health check shows up here in a moment." : "Health check not available yet for this company."}
        </p>
      ) : verdict === null ? (
        <>
          <span className="text-[15px] font-bold">Health check not available</span>
          <p className="m-0 text-sm leading-normal text-ink-2">{snapshot.noScoreReason}</p>
        </>
      ) : (
        <>
          <span className="fine">
            {h.ruleSet === "growth" ? "Growth-company rules" : "Standard rules"} · last 4 quarterly reports{latest ? ` (latest ${dayET(latest + "T12:00:00Z")})` : ""}
          </span>
          <div className="flex flex-col gap-1.5">
            <div className="relative h-2.5 rounded-[5px] bg-black/10" role="img" aria-label={`${percent}% of answers passed`}>
              <div className="absolute inset-y-0 left-0 rounded-[5px] bg-brand" style={{ width: `${percent}%` }} />
              <div aria-hidden="true" className="absolute -bottom-[3px] -top-[3px] left-1/2 w-0.5 bg-ink/50" />
              <div aria-hidden="true" className="absolute -bottom-[3px] -top-[3px] left-3/4 w-0.5 bg-ink/50" />
            </div>
            <div className="flex justify-between gap-2 text-xs">
              <strong className="text-[13px]">{h.passed} of {h.answered} answers passed · {percent}%</strong>
              <span className="text-muted">{RANGE[verdict]}</span>
            </div>
          </div>
          {h.checks.map((c) => (
            <div key={c.key} className="flex items-center gap-2.5 text-sm leading-[1.35]">
              <span className="flex flex-none gap-[3px]" role="img"
                aria-label={c.counted ? c.answers.map((a) => (a === null ? "no answer" : a ? "yes" : "no")).join(", ") : "not counted"}>
                {(c.counted ? c.answers : [null, null, null, null]).map((a, i) => (
                  <span key={i} className="block h-2.5 w-2.5 rounded-full" style={{ background: a === null ? "#d7dfda" : a ? "#0f9a55" : "#e0b36a" }} />
                ))}
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <strong className={c.counted ? "" : "font-bold text-muted"}>{c.label}</strong>
                <span className="text-xs text-muted">{c.hint}</span>
              </span>
            </div>
          ))}
          <span className="fine">
            {h.notes.length ? h.notes.join(" ") + " " : ""}Each dot is one quarter, oldest first: green is yes, amber is no, grey is no answer.
          </span>
        </>
      )}
      <span className="fine">From SEC filings only. Not a rating of the stock and not investment advice.</span>
      <Link href="/health-check" className="mt-auto text-sm font-bold no-underline">How the health check works →</Link>
    </section>
  );
}
