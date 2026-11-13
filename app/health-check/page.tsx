import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/site/Shell";
import { HealthPill } from "@/components/ui/Badges";
import { growthRulesEnabled } from "@/lib/config";
import { popularChecks, type CheckedCompany } from "@/lib/data/companies";
import { db } from "@/lib/db";
import { CHECK_TEXT, RULE_SET_CHECKS } from "@/lib/health/labels";
import type { RuleSet } from "@/lib/health/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Health check: how healthy is the business?",
  description: "A simple Strong, Mixed or Weak, read from the company's own SEC filings. It looks at the business, not the stock price. Not investment advice.",
};

const RESULTS = [
  { label: "Strong", text: "75% or more of the answers pass.", card: "bg-[#f0fbf5] shadow-[0_0_0_1px_#c9ecd8]", pill: "bg-good-bg text-good" },
  { label: "Mixed", text: "50% to 74% pass.", card: "bg-[#fffaf0] shadow-[0_0_0_1px_#f2e2bf]", pill: "bg-amber-bg text-amber" },
  { label: "Weak", text: "Under 50% pass.", card: "bg-[#fff6f6] shadow-[0_0_0_1px_#f3d6d6]", pill: "bg-bad-bg text-bad" },
  { label: "No score yet", text: "Fewer than 8 answers so far.", card: "bg-inset shadow-[0_0_0_1px_var(--color-line)]", pill: "bg-[#eef1ee] text-ink-2" },
];

const RULES_LABEL: Record<RuleSet, string> = { standard: "Standard rules", growth: "Growth-company rules" };

/** The checks of one rule set, numbered. Names and explanations come from the scorer's own labels. */
function Checks({ ruleSet, tone, className = "" }: { ruleSet: RuleSet; tone: string; className?: string }) {
  return (
    <ol className={`m-0 list-none p-0 ${className}`}>
      {RULE_SET_CHECKS[ruleSet].map((key, i) => (
        <li key={key} className="flex items-start gap-3">
          <span aria-hidden="true" className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px] font-extrabold ${tone}`}>{i + 1}</span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <strong className="text-[15px]">{CHECK_TEXT[key].label}</strong>
            <span className="text-[13px] leading-normal text-muted">{CHECK_TEXT[key].hint}.</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-1 rounded-[20px] bg-inset px-[18px] py-4">
      <strong className="text-[15px]">{title}</strong>
      <span className="text-sm leading-normal text-ink-2">{children}</span>
    </div>
  );
}

export default async function HealthCheckPage() {
  const growth = growthRulesEnabled();
  let popular: CheckedCompany[] = [];
  try {
    popular = await popularChecks(db(), 6);
  } catch {
    // The page explains the health check even when the database is down: only the examples are left out.
  }

  return (
    <Shell>
      <section className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-3.5 px-4 pb-6 pt-8 text-center md:px-8 md:pt-10">
        <h1 className="m-0 text-[32px] font-extrabold leading-[1.08] tracking-[-0.035em] md:text-[44px]">Health check: how healthy is the business?</h1>
        <p className="m-0 max-w-[640px] text-[17px] leading-[1.55] text-ink-2">
          A simple Strong, Mixed or Weak, read from the company&apos;s own SEC filings. It looks at the business, not the stock price.
        </p>
        <form role="search" action="/search" className="flex w-full max-w-[560px] gap-2 rounded-[20px] bg-white p-2 shadow-[0_16px_40px_rgba(12,60,35,0.12),0_0_0_1px_#dfe9e3]">
          <label htmlFor="hc-q" className="sr-only">Check a stock</label>
          <input id="hc-q" name="q" type="search" required placeholder="Check any stock: ticker or name" autoComplete="off"
            className="h-[52px] min-w-0 flex-1 border-0 bg-transparent px-2 text-[15px] outline-none md:px-3 md:text-[17px]" />
          <button type="submit" className="btn btn-brand h-[52px] rounded-[14px] px-4 text-base font-extrabold md:px-[22px]">Check</button>
        </form>
      </section>

      <section aria-label="What the results mean" className="mx-auto grid w-full max-w-[900px] grid-cols-2 gap-3.5 px-4 pb-7 pt-2 md:grid-cols-4 md:px-8">
        {RESULTS.map((r) => (
          <div key={r.label} className={`flex flex-col gap-2 rounded-3xl p-4 md:p-5 ${r.card}`}>
            <span className={`self-start rounded-full px-3.5 py-[5px] font-extrabold ${r.pill}`}>{r.label}</span>
            <span className="text-[15px] leading-normal">{r.text}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="hc-rules" className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-4 pb-7 md:px-8">
        <h2 id="hc-rules" className="m-0 text-[22px] font-extrabold tracking-[-0.02em] md:text-[26px]">
          {growth ? "Two rule sets, so young companies are judged fairly" : "Four checks, answered for each of the last four quarterly reports"}
        </h2>
        <p className="m-0 text-[15px] leading-[1.55] text-ink-2">
          Each check is answered once for each of the last 4 quarterly reports, so every answer is a pass or a fail for one quarter. The result
          is the share of answers that pass.
        </p>
        {growth ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card flex flex-col gap-3 rounded-[28px] p-5 shadow-[0_10px_30px_rgba(12,60,35,0.06),0_0_0_1px_var(--color-line)] md:p-6">
              <h3 className="eyebrow m-0 text-blue">Standard rules</h3>
              <span className="text-[15px] text-ink-2">For most companies, including emerging growth companies that already make money from operations.</span>
              <Checks ruleSet="standard" tone="bg-blue-bg text-blue" className="flex flex-col gap-3" />
            </div>
            <div className="card flex flex-col gap-3 rounded-[28px] p-5 shadow-[0_10px_30px_rgba(12,60,35,0.06),0_0_0_1px_var(--color-line)] md:p-6">
              <h3 className="eyebrow m-0">Growth-company rules</h3>
              <span className="text-[15px] text-ink-2">
                For companies that tick the SEC&apos;s &quot;emerging growth company&quot; box and lost money from operations over the last four quarters.
              </span>
              <Checks ruleSet="growth" tone="bg-good-bg text-good" className="flex flex-col gap-3" />
            </div>
          </div>
        ) : (
          <div className="card flex flex-col gap-3.5 rounded-[28px] p-5 shadow-[0_10px_30px_rgba(12,60,35,0.06),0_0_0_1px_var(--color-line)] md:p-6">
            <h3 className="eyebrow m-0 text-blue">The four checks</h3>
            <Checks ruleSet="standard" tone="bg-blue-bg text-blue" className="grid gap-x-6 gap-y-3.5 md:grid-cols-2" />
          </div>
        )}
        <div className={`grid gap-3 ${growth ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {growth && (
            <Tile title="No sales yet?">
              If sales over the last 12 months are zero or under a tenth of costs, the two sales checks don&apos;t count. The result comes from the
              cash and share checks.
            </Tile>
          )}
          <Tile title="Not scored">Blank-check companies (SPACs) and funds get no health check.</Tile>
          <Tile title="Only SEC numbers">
            Every number comes from the company&apos;s own SEC filings. News, trial results and the stock price are not part of it.
          </Tile>
        </div>
        <p className="m-0 text-[13px] text-muted">
          {growth
            ? "Every stock page says which rule set it used and links to the reports the numbers came from."
            : "Every stock page links to the reports the numbers came from."}
        </p>
      </section>

      <section aria-labelledby={popular.length > 0 ? "hc-ex" : undefined} aria-label={popular.length > 0 ? undefined : "About the health check"}
        className="mx-auto w-full max-w-[900px] px-4 pb-12 md:px-8">
        {popular.length > 0 && (
          <>
            <h2 id="hc-ex" className="m-0 mb-2.5 text-xl font-extrabold">Popular checks</h2>
            <div className="card mb-3 overflow-hidden">
              {popular.map((c, i) => (
                <Link key={c.ticker} href={`/stock/${encodeURIComponent(c.ticker)}`}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-ink no-underline hover:bg-inset hover:text-ink ${i > 0 ? "border-t border-line-soft" : ""}`}>
                  <span className="w-[70px] flex-none font-extrabold">${c.ticker}</span>
                  <span className="min-w-0 flex-[1_1_120px] text-[15px]">{c.name}</span>
                  {growth && <span className="text-[13px] text-muted">{RULES_LABEL[c.ruleSet]}</span>}
                  <HealthPill verdict={c.verdict} />
                </Link>
              ))}
            </div>
          </>
        )}
        <p className="fine m-0">The health check describes past filings only. It is not a rating of the stock and not investment advice.</p>
      </section>
    </Shell>
  );
}
