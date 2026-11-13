import type { Metadata } from "next";
import { FeedList } from "@/components/feed/FeedList";
import { SignupCard } from "@/components/signup/SignupCard";
import { Shell } from "@/components/site/Shell";
import { alertCiks } from "@/lib/data/account";
import { feedCounts, getFeed } from "@/lib/data/feed";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/web/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Live news: every press release and SEC filing as it posts",
  description: "Press releases, earnings, insider trades and IPO filings, the moment they post, each explained in one sentence.",
};

export default async function NewsPage() {
  const pool = db();
  const user = await currentUser();
  const [feed, counts, following] = await Promise.all([
    getFeed(pool, { limit: 30 }).then((v) => ({ ...v, ok: true })).catch(() => ({ items: [], next: null, ok: false })),
    feedCounts(pool, new Date(Date.now() - 86_400_000)).catch(() => undefined),
    user ? alertCiks(pool, user.email).catch(() => [] as number[]) : Promise.resolve([] as number[]),
  ]);
  return (
    <Shell>
      <section className="mx-auto flex w-full max-w-[1000px] flex-col gap-2 px-4 pb-4 pt-8 md:px-8">
        <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] md:text-[40px]">Live news</h1>
        <p className="m-0 text-[15px] text-muted">Every press release and SEC filing, as it posts. Click a headline to read it in one sentence.</p>
      </section>
      <div className="mx-auto w-full max-w-[1000px] px-4 pb-8 md:px-8">
        {!feed.ok && (
          <p role="status" className="card mb-3 bg-amber-bg px-5 py-4 text-[15px] text-amber">
            Filings are taking longer than usual. We&apos;ll show them here as soon as they are back.
          </p>
        )}
        <FeedList initial={feed.items} next={feed.next} counts={counts} filters={["press", "earnings", "news", "insider", "ipo", "proxy"]} paged textFilter
          signedIn={Boolean(user)} following={following} title="Latest" emptyText="Nothing in this category yet today." />
      </div>
      {!user && (
        <div className="mx-auto w-full max-w-[1000px] px-4 pb-12 md:px-8">
          <SignupCard title="Get this feed for your stocks" text="By email, the moment something posts. Plus the free daily pick." button="Sign up free" source="news" />
        </div>
      )}
    </Shell>
  );
}
