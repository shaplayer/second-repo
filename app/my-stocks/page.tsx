import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AddStock, RemoveStock, StockAlertToggle } from "@/components/account/AccountForms";
import { FeedRows } from "@/components/feed/FeedRows";
import { Shell } from "@/components/site/Shell";
import { TradingViewWidget } from "@/components/tv/TradingViewWidget";
import { HealthPill, Initials } from "@/components/ui/Badges";
import { TimeAgo } from "@/components/ui/TimeAgo";
import { maskEmail } from "@/lib/auth/accounts";
import { listMyStocks } from "@/lib/data/account";
import { getFeed, type FeedItem } from "@/lib/data/feed";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/web/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My stocks", robots: { index: false } };

export default async function MyStocksPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?next=/my-stocks");
  const pool = db();
  const dayAgo = new Date(Date.now() - 86_400_000);
  const stocks = await listMyStocks(pool, user, dayAgo).catch(() => null);
  const feed = stocks?.length
    ? await getFeed(pool, { ciks: stocks.map((s) => s.cik), limit: 15 }).then((p) => p.items).catch(() => [] as FeedItem[])
    : [];

  return (
    <Shell>
      <section className="mx-auto flex w-full max-w-[1000px] flex-wrap items-end justify-between gap-4 px-4 pb-5 pt-8 md:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] md:text-[40px]">My stocks</h1>
          <span className="text-[15px] text-ink-2">
            {stocks ? `${stocks.length} ${stocks.length === 1 ? "stock" : "stocks"} · ` : ""}alerts go to {maskEmail(user.email)}
          </span>
        </div>
        <div className="w-full max-w-[380px]"><AddStock /></div>
      </section>

      {stocks === null && (
        <p role="status" className="card mx-4 max-w-[1000px] bg-amber-bg px-5 py-4 text-[15px] text-amber md:mx-auto">
          We couldn&apos;t load your stocks just now. Your alerts are not affected. Please try again in a minute.
        </p>
      )}
      {stocks?.length === 0 && (
        <section className="mx-auto w-full max-w-[1000px] px-4 pb-8 md:px-8">
          <div className="card-mint flex flex-col gap-2 p-6">
            <strong className="text-lg">No stocks yet</strong>
            <p className="m-0 text-[15px] text-ink-2">
              Add a stock above, or press “Alert me” on any post in <Link href="/news" className="font-bold">live news</Link>. You&apos;ll get its press
              releases and SEC filings by email the moment they post.
            </p>
          </div>
        </section>
      )}

      {stocks && stocks.length > 0 && (
        <section aria-label="Followed stocks" className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-4 px-4 pb-7 md:grid-cols-2 md:px-8">
          {stocks.map((s) => {
            const label = s.ticker ? `$${s.ticker}` : s.name;
            const href = s.ticker ? `/stock/${encodeURIComponent(s.ticker)}` : `/stock/CIK${s.cik}`;
            return (
              <article key={s.cik} className="flex flex-col gap-3.5 rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(12,60,35,0.06),0_0_0_1px_#e3ebe6]">
                <div className="flex items-center gap-3">
                  <Initials name={s.name} ticker={s.ticker} size={46} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link href={href} className="text-[19px] font-extrabold text-ink no-underline hover:text-link">{label}</Link>
                    <span className="truncate text-[13px] text-muted">{s.name}</span>
                  </div>
                  <HealthPill verdict={s.verdict} />
                </div>
                {s.tvSymbol && (
                  <div className="overflow-hidden rounded-[14px] bg-inset">
                    <TradingViewWidget kind="mini-symbol-overview" symbol={s.tvSymbol} height={110} label={`${label} price chart, from TradingView`} />
                  </div>
                )}
                {s.latest ? (
                  <Link href={s.latest.path} className="flex flex-col gap-[3px] text-ink no-underline hover:text-ink">
                    <span className="text-xs text-muted">
                      {s.fresh > 0 && <strong className="text-good">{s.fresh} new · </strong>}
                      <TimeAgo iso={s.latest.publishedAt} suffix />
                    </span>
                    <span className="text-[15px] font-bold leading-[1.4]">{s.latest.headline}</span>
                  </Link>
                ) : (
                  <span className="text-sm text-muted">No news yet. We&apos;ll email you when they post.</span>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-2.5">
                  <span className="mr-1 text-[13px] font-bold text-ink-2">Alerts:</span>
                  <StockAlertToggle cik={s.cik} on={s.alerts} />
                  <RemoveStock cik={s.cik} label={label} />
                </div>
              </article>
            );
          })}
        </section>
      )}

      {feed.length > 0 && (
        <section aria-labelledby="ms-feed" className="mx-auto w-full max-w-[1000px] px-4 pb-12 md:px-8">
          <div className="card overflow-hidden rounded-[28px] px-5 pb-2 pt-5 md:px-6">
            <div className="flex items-center justify-between gap-3 pb-3">
              <h2 id="ms-feed" className="m-0 flex items-center gap-2.5 text-[22px] font-extrabold"><span className="live-dot" />News on my stocks</h2>
              <Link href="/settings" className="text-sm font-bold no-underline">Alert settings</Link>
            </div>
            <FeedRows items={feed} />
          </div>
        </section>
      )}
      <p className="fine mx-auto w-full max-w-[1000px] px-4 pb-10 md:px-8">Price charts by TradingView.</p>
    </Shell>
  );
}
