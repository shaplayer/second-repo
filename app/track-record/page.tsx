import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/sections/Footer";
import { SignupForm } from "@/components/SignupForm";
import { ResultBadge } from "@/components/ResultBadge";
import { ResultsStrip } from "@/components/ResultsStrip";
import { Search } from "@/components/Icons";
import { alertStats, listAlerts, pct, resultSequence, type AlertFilter, type AlertResult, type AlertRow } from "@/lib/alerts";
import { formatET, formatPercent, formatPrice } from "@/lib/format";
import { normalizeTicker } from "@/lib/feeds/tickers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Public Track Record: Every Alert, Wins and Losses | BigStocks",
  description: "Every BigStocks stock alert, timestamped when sent, with wins and losses. Sponsored alerts labeled. Download the full record as CSV.",
};

const PAGE_SIZE = 50;
type SP = { type?: string; result?: string; ticker?: string; page?: string };

function parse(sp: SP): { f: Required<AlertFilter>; page: number } {
  const type = sp.type === "organic" || sp.type === "sponsored" ? sp.type : "all";
  const result = (["win", "loss", "flat", "open"] as const).find((r) => r === sp.result) ?? "all";
  return { f: { type, result, ticker: normalizeTicker(sp.ticker) }, page: Math.max(1, Number(sp.page) || 1) };
}

function hrefWith(f: Required<AlertFilter>, patch: Partial<Record<"type" | "result" | "ticker" | "page", string | null>>) {
  const p = new URLSearchParams();
  const next = { type: f.type, result: f.result, ticker: f.ticker, page: null as string | null, ...patch };
  if (next.type && next.type !== "all") p.set("type", next.type);
  if (next.result && next.result !== "all") p.set("result", next.result);
  if (next.ticker) p.set("ticker", next.ticker);
  if (next.page && next.page !== "1") p.set("page", next.page);
  const s = p.toString();
  return s ? `/track-record?${s}` : "/track-record";
}

const Move = ({ from, to }: { from: number; to: number | null }) => {
  const p = pct(from, to);
  if (to == null) return <span className="text-faint">-</span>;
  return (
    <span className="num whitespace-nowrap">
      {formatPrice(to)}{" "}
      <span className={`text-[12px] ${p == null ? "text-faint" : p > 0 ? "text-brand" : p < 0 ? "text-down" : "text-muted"}`}>{formatPercent(p)}</span>
    </span>
  );
};

function Sponsored({ a }: { a: AlertRow }) {
  if (!a.sponsored) return null;
  return (
    <span className="mt-1 block text-[11.5px] leading-snug text-faint">
      <span className="mr-1.5 rounded bg-white/[0.07] px-1.5 py-px font-semibold uppercase tracking-wider text-muted">Sponsored</span>
      {a.sponsorComp}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col-reverse justify-end bg-surface p-5 md:p-6">
      <dt className="mt-1 text-[13px] text-muted">{label}{sub && <span className="mt-0.5 block text-[12px] text-faint">{sub}</span>}</dt>
      <dd className="num text-[26px] font-semibold tracking-tight md:text-[32px]">{value}</dd>
    </div>
  );
}

export default async function TrackRecordPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { f, page } = parse(await searchParams);
  const [stats, list, strip] = await Promise.all([
    alertStats({ type: f.type }),
    listAlerts(f, page, PAGE_SIZE),
    resultSequence({ type: f.type }, 60),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const hasAny = stats.total > 0 || f.type !== "all";

  const seg = (on: boolean) => `rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors ${on ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink"}`;
  const closed = stats.wins + stats.losses + stats.flat;

  return (
    <>
      <Nav />
      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="pointer-events-none absolute left-[-10%] top-[-40%] h-[520px] w-[620px] rounded-full bg-brand/[0.06] blur-[120px]" aria-hidden="true" />
          <div className="container-wide relative py-14 md:py-20">
            <p className="eyebrow">Public track record</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.06] tracking-[-0.03em] md:text-[54px]">
              Every alert. <span className="text-gradient">Wins and losses.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-muted">
              Every BigStocks alert is logged the moment it&apos;s sent. Records can&apos;t be edited or deleted, losses stay up,
              and sponsored alerts are labeled with what we were paid. Check our math anytime.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/api/alerts/export" className="btn-ghost !h-11">Download full record (CSV)</a>
              <a href="#methodology" className="btn-ghost !h-11">How we measure</a>
            </div>
          </div>
        </section>

        <div className="container-wide space-y-6 py-10 md:py-14">
          {hasAny && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav aria-label="Alert type" className="inline-flex rounded-full border border-line bg-surface p-1">
                <Link href={hrefWith(f, { type: "all" })} className={seg(f.type === "all")} aria-current={f.type === "all" ? "page" : undefined}>All alerts</Link>
                <Link href={hrefWith(f, { type: "organic" })} className={seg(f.type === "organic")} aria-current={f.type === "organic" ? "page" : undefined}>Organic only</Link>
                <Link href={hrefWith(f, { type: "sponsored" })} className={seg(f.type === "sponsored")} aria-current={f.type === "sponsored" ? "page" : undefined}>Sponsored only</Link>
              </nav>
              <span className="text-[12.5px] text-faint">Stats below reflect: {f.type === "all" ? "all alerts" : f.type === "organic" ? "organic alerts only" : "sponsored alerts only"}</span>
            </div>
          )}

          {hasAny ? (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-line bg-line md:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
                <Stat label="Alerts tracked" value={stats.total.toLocaleString("en-US")} sub={stats.open ? `${stats.open} still open` : undefined} />
                <Stat label="Win rate" value={stats.winRate == null ? "-" : `${stats.winRate.toFixed(0)}%`} sub={closed ? `${stats.wins} W · ${stats.losses} L · ${stats.flat} flat` : "No closed alerts yet"} />
                <Stat label="Avg. move to close" value={formatPercent(stats.avgClosePct)} sub="Alert price → same-day close" />
                <Stat label="Avg. move to high" value={formatPercent(stats.avgHighPct)} sub="Alert price → session high" />
                <Stat label="Tracking since" value={stats.firstAt ? new Date(stats.firstAt).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/New_York" }) : "-"}
                  sub={stats.worstClosePct != null ? `Worst close ${formatPercent(stats.worstClosePct)}` : undefined} />
              </dl>

              <ResultsStrip items={strip} />

              <div className="card overflow-clip">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
                  <nav aria-label="Result" className="flex flex-wrap gap-1">
                    {(["all", "win", "loss", "open"] as const).map((r) => (
                      <Link key={r} href={hrefWith(f, { result: r })} className={seg(f.result === r)} aria-current={f.result === r ? "page" : undefined}>
                        {r === "all" ? "All results" : r === "win" ? "Wins" : r === "loss" ? "Losses" : "Open"}
                      </Link>
                    ))}
                  </nav>
                  <form action="/track-record" className="flex h-9 items-center gap-2 rounded-full border border-line-strong bg-bg px-3 focus-within:border-brand/60">
                    {f.type !== "all" && <input type="hidden" name="type" value={f.type} />}
                    {f.result !== "all" && <input type="hidden" name="result" value={f.result} />}
                    <Search className="h-3.5 w-3.5 text-faint" />
                    <label htmlFor="tr-ticker" className="sr-only">Filter by ticker</label>
                    <input id="tr-ticker" name="ticker" defaultValue={f.ticker ?? ""} placeholder="Ticker" maxLength={10}
                      className="w-24 bg-transparent font-mono text-[13px] uppercase text-ink placeholder:font-sans placeholder:normal-case placeholder:text-faint focus:outline-none" />
                    {f.ticker && <Link href={hrefWith(f, { ticker: null })} className="text-[12px] text-faint hover:text-ink">Clear</Link>}
                  </form>
                </div>

                {list.rows.length === 0 ? (
                  <p className="px-6 py-14 text-center text-muted">No alerts match these filters.</p>
                ) : (
                  <>
                    {/* Desktop table */}
                    <table className="hidden w-full text-[14px] md:table">
                      <caption className="sr-only">Alert history, newest first</caption>
                      <thead className="border-b border-line text-[11px] uppercase tracking-[0.12em] text-faint">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left font-medium">Sent (ET)</th>
                          <th scope="col" className="px-4 py-3 text-left font-medium">Ticker</th>
                          <th scope="col" className="px-4 py-3 text-right font-medium">Alert price</th>
                          <th scope="col" className="px-4 py-3 text-right font-medium">High after</th>
                          <th scope="col" className="px-4 py-3 text-right font-medium">Close</th>
                          <th scope="col" className="px-6 py-3 text-right font-medium">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {list.rows.map((a) => (
                          <tr key={a.id} id={`alert-${a.id}`} className="scroll-mt-28 align-top transition-colors target:bg-brand/[0.06] hover:bg-white/[0.02]">
                            <td className="num whitespace-nowrap px-6 py-3.5 text-muted">{formatET(a.alertedAt)}</td>
                            <td className="max-w-[340px] px-4 py-3.5">
                              <Link href={`/news/${a.ticker}`} className="font-mono font-semibold hover:text-brand">${a.ticker}</Link>
                              <Sponsored a={a} />
                            </td>
                            <td className="num px-4 py-3.5 text-right">{formatPrice(a.alertPrice)}</td>
                            <td className="px-4 py-3.5 text-right"><Move from={a.alertPrice} to={a.highAfter} /></td>
                            <td className="px-4 py-3.5 text-right"><Move from={a.alertPrice} to={a.closeAfter} /></td>
                            <td className="px-6 py-3.5 text-right"><ResultBadge result={a.result} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Mobile cards */}
                    <ul className="divide-y divide-line md:hidden">
                      {list.rows.map((a) => (
                        <li key={a.id} id={`alert-${a.id}-m`} className="px-5 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Link href={`/news/${a.ticker}`} className="font-mono text-[15px] font-semibold">${a.ticker}</Link>
                              <p className="num mt-0.5 text-[12.5px] text-faint">{formatET(a.alertedAt)}</p>
                            </div>
                            <ResultBadge result={a.result} />
                          </div>
                          <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
                            <div><dt className="text-[11px] uppercase tracking-wider text-faint">Alert</dt><dd className="num mt-0.5">{formatPrice(a.alertPrice)}</dd></div>
                            <div><dt className="text-[11px] uppercase tracking-wider text-faint">High</dt><dd className="mt-0.5"><Move from={a.alertPrice} to={a.highAfter} /></dd></div>
                            <div><dt className="text-[11px] uppercase tracking-wider text-faint">Close</dt><dd className="mt-0.5"><Move from={a.alertPrice} to={a.closeAfter} /></dd></div>
                          </dl>
                          <Sponsored a={a} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {pages > 1 && (
                  <nav aria-label="Pages" className="flex items-center justify-between border-t border-line px-5 py-3.5 text-[13.5px] sm:px-6">
                    {page > 1 ? <Link href={hrefWith(f, { page: String(page - 1) })} className="btn-ghost !h-9">← Newer</Link> : <span />}
                    <span className="num text-faint">Page {page} of {pages} · {list.total.toLocaleString("en-US")} alerts</span>
                    {page < pages ? <Link href={hrefWith(f, { page: String(page + 1) })} className="btn-ghost !h-9">Older →</Link> : <span />}
                  </nav>
                )}
              </div>
            </>
          ) : (
            <div className="card relative overflow-hidden px-6 py-16 text-center md:py-20">
              <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[600px] -translate-x-1/2 rounded-full bg-brand/10 blur-[100px]" aria-hidden="true" />
              <p className="relative eyebrow justify-center">Launching soon</p>
              <h2 className="relative mx-auto mt-4 max-w-xl text-[28px] font-semibold tracking-tight md:text-[34px]">Our public record starts with the next alert.</h2>
              <p className="relative mx-auto mt-3 max-w-md text-[15px] text-muted">From then on, every alert lands here, timestamped, wins and losses included. Get the next one as it&apos;s sent:</p>
              <div className="relative mt-8 flex justify-center"><SignupForm source="track-record" /></div>
            </div>
          )}

          <section id="methodology" className="scroll-mt-24 grid gap-5 lg:grid-cols-[1.3fr_1fr]" aria-labelledby="method-title">
            <div className="card p-7 md:p-9">
              <p className="eyebrow">Methodology</p>
              <h2 id="method-title" className="mt-3 text-[24px] font-semibold tracking-tight md:text-[28px]">How we measure every alert</h2>
              <dl className="mt-6 divide-y divide-line text-[14.5px]">
                {[
                  ["Sent", "The time the alert went out to subscribers, in US Eastern time. Each record also stores when it was logged (in the CSV)."],
                  ["Alert price", "The stock's price at the moment the alert was sent."],
                  ["High after", "The highest price the stock reached after the alert, during the same trading session."],
                  ["Close", "The official closing price on the alert day."],
                  ["Result", "Win if the close is above the alert price, loss if below, flat if equal. Open until the session closes."],
                  ["Sponsored", "Alerts we were paid for. Labeled with the compensation, included in every stat, and filterable so you can judge them separately."],
                  ["Permanent", "Our database blocks deleting alerts and blocks changing the ticker, time, price or sponsorship after an alert is logged."],
                ].map(([t, d]) => (
                  <div key={t} className="grid gap-1 py-3.5 sm:grid-cols-[130px_1fr] sm:gap-6">
                    <dt className="font-semibold">{t}</dt>
                    <dd className="leading-relaxed text-muted">{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="card flex flex-col p-7 md:p-9">
              <h2 className="text-[20px] font-semibold tracking-tight">Read this before you trade</h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
                Past performance does not guarantee future results. Small-cap and pre-market stocks are volatile, and you can lose money,
                including your entire investment. &ldquo;High after&rdquo; shows the best price reached, which most traders won&apos;t capture.
                Our alerts are information, not investment advice.
              </p>
              <div className="mt-8 flex-1" />
              <a href="/api/alerts/export" className="btn-ghost self-start">Download the raw data (CSV)</a>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
