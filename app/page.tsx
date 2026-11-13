import Link from "next/link";
import { FeedList } from "@/components/feed/FeedList";
import { SignupForm } from "@/components/signup/SignupForm";
import { Shell } from "@/components/site/Shell";
import { Countdown } from "@/components/ui/Countdown";
import { SearchIcon } from "@/components/ui/Icons";
import { TimeAgo } from "@/components/ui/TimeAgo";
import { clockET } from "@/lib/time";
import { audience } from "@/lib/config";
import { alertCiks, listMyStocks, type MyStock } from "@/lib/data/account";
import { trendingCompanies, type Trending } from "@/lib/data/companies";
import { feedCounts, getFeed, type FeedPage } from "@/lib/data/feed";
import { latestFreePick, type StockPick } from "@/lib/data/picks";
import { db } from "@/lib/db";
import { pickSchedule } from "@/lib/schedule";
import { currentUser } from "@/lib/web/request";

export const dynamic = "force-dynamic";

const FILTERS = ["press", "earnings", "insider", "ipo", "news"] as const;

/** Each part of the page loads on its own: if one fails, the others still show. */
async function safe<T>(load: () => Promise<T>, fallback: T): Promise<{ value: T; ok: boolean }> {
  try {
    return { value: await load(), ok: true };
  } catch (e) {
    console.error("[home]", (e as Error).message);
    return { value: fallback, ok: false };
  }
}

export default async function Home() {
  const user = await currentUser();
  const pool = db();
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [feed, counts, trending, pick, mine, following] = await Promise.all([
    safe<FeedPage>(() => getFeed(pool, { limit: 60 }), { items: [], next: null }),
    safe(() => feedCounts(pool, dayAgo), undefined),
    safe<Trending[]>(() => trendingCompanies(pool, 6), []),
    safe<StockPick | null>(() => latestFreePick(pool), null),
    safe<MyStock[]>(() => (user ? listMyStocks(pool, user, dayAgo) : Promise.resolve([])), []),
    safe<number[]>(() => (user ? alertCiks(pool, user.email) : Promise.resolve([])), []),
  ]);
  const schedule = pickSchedule();
  const fresh = mine.value.reduce((n, s) => n + s.fresh, 0);
  const mineLatest = mine.value.filter((s) => s.latest).sort((a, b) => b.latest!.publishedAt.localeCompare(a.latest!.publishedAt)).slice(0, 3);
  const pickIsToday = pick.value && Date.now() - Date.parse(pick.value.postedAt) < 20 * 3600_000;

  return (
    <Shell search={false}>
      <section className="wrap-narrow flex flex-col items-center gap-4 pb-9 pt-10 text-center md:pt-14">
        <h1 className="m-0 text-[31px] font-extrabold leading-[1.08] tracking-[-0.035em] md:text-[52px] md:leading-[1.06] md:tracking-[-0.04em]">
          What&apos;s the latest on your stock?
        </h1>
        <p className="m-0 text-[15px] leading-[1.55] text-ink-2 md:text-lg">
          Every press release and SEC filing, explained in one sentence, the moment it posts.
        </p>
        <form role="search" action="/search" className="mt-1.5 flex w-full gap-2 rounded-[18px] bg-white p-1.5 shadow-[0_20px_50px_rgba(12,60,35,0.14),0_0_0_1px_#dfe9e3] md:rounded-[22px] md:p-2">
          <label htmlFor="home-q" className="sr-only">Ticker or company</label>
          <span aria-hidden="true" className="hidden items-center pl-3 text-ink-2 md:flex"><SearchIcon className="h-[22px] w-[22px]" /></span>
          <input id="home-q" name="q" type="search" required placeholder="Ticker or company, e.g. AAPL" autoComplete="off"
            className="h-[50px] min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[17px] outline-none md:h-[60px] md:text-xl" />
          <button type="submit" className="btn btn-brand h-[50px] rounded-[13px] px-4 text-base font-extrabold md:h-[60px] md:rounded-2xl md:px-7">
            <SearchIcon className="h-5 w-5 md:hidden" /><span className="sr-only md:not-sr-only">Search</span>
          </button>
        </form>
        {trending.value.length > 0 && (
          <div className="flex w-full gap-2 overflow-x-auto pb-0.5 text-sm text-muted md:flex-wrap md:justify-center">
            <span className="hidden self-center md:inline">Trending:</span>
            {trending.value.map((t) => (
              <Link key={t.ticker} href={`/stock/${encodeURIComponent(t.ticker)}`} className="chip flex-none" title={t.name}>${t.ticker}</Link>
            ))}
          </div>
        )}
      </section>

      <section id="pick" className="wrap pb-8">
        <div className="card-dark relative flex flex-wrap items-center gap-10 overflow-hidden rounded-[28px] px-4 py-6 md:rounded-[40px] md:px-11 md:py-10">
          <div aria-hidden="true" className="pointer-events-none absolute -left-[120px] -top-[280px] h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle,rgba(31,224,127,0.2),rgba(31,224,127,0)_65%)]" />
          <div className="relative flex min-w-0 flex-[1_1_520px] flex-col gap-[18px]">
            <span className="text-[15px] font-bold text-dark-accent">
              {schedule.phase === "window" ? "Today's free stock pick lands before the opening bell, in" : `${schedule.nextDay === "Today" ? "Today" : schedule.nextDay}'s free stock pick lands in`}
            </span>
            <Countdown msLeft={schedule.msLeft} />
            {pick.value && (
              <Link href="/picks" className="flex max-w-[560px] flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-[18px] border border-white/[0.12] bg-white/[0.07] px-4 py-3.5 text-white no-underline hover:text-white">
                <span className="text-xs font-extrabold tracking-[0.08em] text-dark-accent">
                  {pickIsToday ? `TODAY'S PICK · SENT ${clockET(pick.value.postedAt)} ET` : "LATEST PICK"}
                </span>
                <span className="text-xl font-extrabold">${pick.value.ticker}</span>
                <span className="min-w-0 flex-[1_1_240px] text-sm leading-[1.45] text-dark-muted">{pick.value.title}</span>
                <span className="text-[13px] font-bold text-dark-accent">Every past pick →</span>
              </Link>
            )}
            <div className="max-w-[560px]">
              {user ? (
                <p className="m-0 text-[15px] text-dark-muted">
                  You&apos;re signed in as {user.email}. <Link href="/settings" className="font-bold text-dark-accent">Choose your alerts</Link>
                </p>
              ) : (
                <SignupForm source="home-hero" button="Send me the free pick" layout="row" />
              )}
              <p className="m-0 mt-2 text-xs leading-normal text-dark-fine">Join {audience.emailSubscribers.toLocaleString("en-US")}+ investors.</p>
            </div>
          </div>
          <div role="img" aria-label="Example of a free pick email" className="relative hidden flex-[0_1_300px] flex-col items-center md:flex">
            <div className="flex w-[280px] rotate-2 flex-col gap-1 rounded-2xl bg-white px-4 py-3.5 text-ink shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
              <span className="text-[11px] text-placeholder">Email · BigStocks · 8:12 AM</span>
              <span className="text-[13px] font-extrabold">Today&apos;s free pick: $TICKER</span>
              <span className="text-xs text-ink-2">Why we picked it, in one sentence.</span>
            </div>
            <div className="-mt-2 flex w-[280px] -rotate-3 flex-col gap-1 rounded-2xl bg-white px-4 py-3.5 text-ink shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
              <span className="text-[11px] text-placeholder">Email · BigStocks · seconds after it posts</span>
              <span className="text-[13px] font-extrabold">$TICKER: Released earnings results</span>
              <span className="text-xs text-ink-2">The filing in one sentence, with a link to the original.</span>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="home-mine" className="wrap pb-6">
        <div className="card-mint flex flex-col gap-3 rounded-[28px] px-4 py-5 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <h2 id="home-mine" className="m-0 text-xl font-extrabold">
              Your stocks
              {user && fresh > 0 && <span className="text-sm font-semibold text-muted"> · {fresh} new {fresh === 1 ? "post" : "posts"} in the last day</span>}
            </h2>
            {user && (
              <div className="flex gap-2 overflow-x-auto md:flex-wrap">
                {mine.value.slice(0, 8).map((s) => (
                  <Link key={s.cik} href={s.ticker ? `/stock/${encodeURIComponent(s.ticker)}` : `/stock/CIK${s.cik}`}
                    className={`flex flex-none items-center gap-2 rounded-full bg-white px-3.5 py-2.5 text-sm font-extrabold text-ink no-underline ${s.fresh ? "shadow-[0_0_0_1px_#9fd8b8]" : "shadow-[0_0_0_1px_#e3ebe6]"}`}>
                    {s.ticker ? `$${s.ticker}` : s.name}
                    {s.fresh > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-brand px-1.5 text-[11px] text-white">{s.fresh}</span>}
                  </Link>
                ))}
                <Link href="/my-stocks" className="flex-none rounded-full border border-dashed border-dark-fine bg-white px-3.5 py-2.5 text-sm font-bold text-ink-2 no-underline">+ Add</Link>
              </div>
            )}
          </div>
          {user && mineLatest.length > 0 ? (
            mineLatest.map((s) => (
              <Link key={s.cik} href={s.latest!.path} className="flex items-baseline gap-3.5 rounded-[14px] bg-white px-3.5 py-3 text-ink no-underline">
                <span className="w-16 flex-none truncate font-extrabold">{s.ticker ? `$${s.ticker}` : s.name}</span>
                <span className="min-w-0 flex-1 text-base leading-[1.45]">{s.latest!.headline}</span>
                <TimeAgo iso={s.latest!.publishedAt} className="flex-none text-[13px] text-muted" />
              </Link>
            ))
          ) : (
            <p className="m-0 text-[15px] text-ink-2">
              {user
                ? <>Nothing here yet. <Link href="/my-stocks" className="font-bold">Add a stock</Link> to see its news in this box.</>
                : <>Follow a stock to get its news here: tap “Alert me” on any post below, or <Link href="/sign-in" className="font-bold">sign in</Link>.</>}
            </p>
          )}
        </div>
      </section>

      <section id="live" aria-label="Live news" className="wrap pb-14">
        {!feed.ok && (
          <p role="status" className="card mb-3 bg-amber-bg px-5 py-4 text-[15px] text-amber">
            Filings are taking longer than usual. We&apos;ll show them here as soon as they are back.
          </p>
        )}
        <FeedList
          initial={feed.value.items} next={feed.value.next} counts={counts.value} filters={[...FILTERS]} signedIn={Boolean(user)} following={following.value}
          rows={12} moreHref="/news" moreLabel="See all live news" emptyText="Nothing in this category in the last few minutes."
        />
      </section>
    </Shell>
  );
}
