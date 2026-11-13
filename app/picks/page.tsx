import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/signup/SignupForm";
import { Shell } from "@/components/site/Shell";
import { TradingViewCredit, TradingViewWidget } from "@/components/tv/TradingViewWidget";
import { Countdown } from "@/components/ui/Countdown";
import { getCompanyByCik, getSnapshot } from "@/lib/data/companies";
import { latestFreePick, listPicks, sponsorLine, type StockPick } from "@/lib/data/picks";
import { db } from "@/lib/db";
import { pickSchedule } from "@/lib/schedule";
import { clockET, dateET } from "@/lib/time";
import { currentUser } from "@/lib/web/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Free stock picks",
  description: "One free pick each trading morning with the reason in one sentence. Sponsored picks always say who paid, how much and in what form.",
};

export default async function PicksPage() {
  const pool = db();
  const user = await currentUser();
  const [latest, all] = await Promise.all([latestFreePick(pool).catch(() => null), listPicks(pool, { limit: 60 }).catch(() => [] as StockPick[])]);
  const schedule = pickSchedule();
  const company = latest?.cik ? await getCompanyByCik(pool, latest.cik).catch(() => null) : null;
  const health = latest?.cik ? await getSnapshot(pool, latest.cik).catch(() => null) : null;
  const today = latest && Date.now() - Date.parse(latest.postedAt) < 20 * 3600_000;

  return (
    <Shell>
      <section className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-2.5 px-4 pb-6 pt-8 text-center md:px-8">
        <h1 className="m-0 text-[34px] font-extrabold tracking-[-0.035em] md:text-[44px]">Free stock picks</h1>
        <p className="m-0 max-w-[600px] text-[17px] leading-[1.55] text-ink-2">
          One pick each trading morning, 8:00 to 9:30 AM ET, with the reason in one sentence. Sent by email.
        </p>
      </section>

      <section className="mx-auto w-full max-w-[1000px] px-4 pb-7 md:px-8">
        <div className="card-dark relative flex flex-wrap items-center gap-8 overflow-hidden rounded-[28px] px-4 py-6 md:rounded-[40px] md:px-10 md:py-9">
          <div aria-hidden="true" className="pointer-events-none absolute -left-[120px] -top-[280px] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(31,224,127,0.2),rgba(31,224,127,0)_65%)]" />
          <div className="relative flex min-w-0 flex-[1_1_380px] flex-col gap-3.5">
            <span className="text-[15px] font-bold text-dark-accent">
              {schedule.phase === "window" ? "Today's pick lands before the opening bell, in" : `${schedule.nextDay}'s pick lands in`}
            </span>
            <Countdown msLeft={schedule.msLeft} />
          </div>
          <div className="relative min-w-0 flex-[1_1_360px]">
            {user ? (
              <p className="m-0 text-[15px] leading-normal text-dark-muted">
                You&apos;re signed in as {user.email}. <Link href="/settings" className="font-bold text-dark-accent">Check that the free pick is on</Link>.
              </p>
            ) : (
              <SignupForm source="picks" button="Send me the free pick" layout="row" />
            )}
          </div>
        </div>
      </section>

      {latest && (
        <section aria-labelledby="pk-today" className="mx-auto w-full max-w-[1000px] px-4 pb-7 md:px-8">
          <div className="card-mint flex flex-wrap gap-6 rounded-[28px] px-5 py-6 md:px-7">
            <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2">
              <h2 id="pk-today" className="eyebrow m-0 text-[13px]">
                {today ? `Today's pick · Sent ${clockET(latest.postedAt)} ET` : `Latest pick · ${dateET(latest.postedAt)}`}
              </h2>
              <span className="text-[32px] font-extrabold tracking-[-0.03em] md:text-[40px]">
                ${latest.ticker} <span className="text-lg font-bold text-muted">{latest.company}</span>
              </span>
              <p className="m-0 text-lg font-bold leading-normal">{latest.title}</p>
              {(latest.why || health?.verdict) && (
                <p className="m-0 text-[15px] leading-[1.55] text-ink-2">
                  {latest.why && <>Why it&apos;s on our radar: {latest.why} </>}
                  {health?.verdict && <>Health check: {health.verdict}.</>}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1.5">
                <Link href={`/stock/${encodeURIComponent(latest.ticker)}`} className="btn btn-dark">See ${latest.ticker} page</Link>
                {latest.sourceUrl && <a href={latest.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline">Read the source ↗</a>}
              </div>
            </div>
            {company?.tvSymbol && (
              <div className="flex min-h-[200px] min-w-0 flex-[1_1_260px] flex-col justify-between gap-2 rounded-[20px] bg-white p-4 shadow-[0_0_0_1px_#d6ece0]">
                <span className="text-sm font-bold">${latest.ticker} today</span>
                <TradingViewWidget kind="mini-symbol-overview" symbol={company.tvSymbol} height={150} label={`$${latest.ticker} price chart, from TradingView`} />
                <TradingViewCredit />
              </div>
            )}
            <p className="m-0 w-full text-[13px] leading-normal text-ink-2">
              Not sponsored. No one paid for this pick. When a company pays, we say so on the pick and in the email, with who paid, how much and in what form.
              {latest.ownsShares === true && <> BigStocks staff own shares in this company{latest.ownershipNote ? `: ${latest.ownershipNote}` : "."}</>}
            </p>
          </div>
        </section>
      )}

      <section aria-labelledby="pk-past" className="mx-auto w-full max-w-[1000px] px-4 pb-12 md:px-8">
        <div className="card overflow-hidden rounded-[28px]">
          <div className="px-5 pb-3 pt-5 md:px-6">
            <h2 id="pk-past" className="m-0 text-[22px] font-extrabold">Past picks</h2>
            <span className="text-sm text-muted">Every pick we&apos;ve sent, newest first</span>
          </div>
          {all.length === 0 && <p className="m-0 border-t border-line-soft px-6 py-7 text-center text-[15px] text-muted">No picks yet. The first one lands at the next trading-day window.</p>}
          {all.map((p) => {
            const paid = sponsorLine(p);
            return (
              <Link key={p.id} href={`/stock/${encodeURIComponent(p.ticker)}`}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line-soft px-5 py-4 text-ink no-underline hover:text-ink md:px-6">
                <span className="num w-[92px] flex-none text-[13px] text-muted">{dateET(p.postedAt)}</span>
                <span className="w-20 flex-none font-extrabold">${p.ticker}</span>
                <span className="min-w-0 flex-[1_1_320px] text-[15px] leading-[1.45]">
                  {p.title}
                  {paid && <span className="mt-1 block text-[13px] font-bold text-amber">{paid}</span>}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${p.sponsored ? "bg-amber-bg text-amber" : "bg-good-bg text-good"}`}>
                  {p.sponsored ? "SPONSORED" : "FREE PICK"}
                </span>
              </Link>
            );
          })}
          <p className="fine m-0 border-t border-line-soft px-5 py-4 md:px-6">
            Picks are ideas to research, not advice. Past picks do not guarantee future results.
          </p>
        </div>
      </section>
    </Shell>
  );
}
