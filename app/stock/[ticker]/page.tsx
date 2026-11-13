import type { Metadata } from "next";
import Link from "next/link";
import { FeedList } from "@/components/feed/FeedList";
import { HealthCard } from "@/components/health/HealthCard";
import { SignupCard } from "@/components/signup/SignupCard";
import { Shell } from "@/components/site/Shell";
import { FollowButton, Gathering } from "@/components/stock/StockActions";
import { TradingViewCredit, TradingViewWidget } from "@/components/tv/TradingViewWidget";
import { Initials } from "@/components/ui/Badges";
import { alertCiks, watchlistCiks } from "@/lib/data/account";
import { getCompanyByCik, getCompanyByTicker, getSnapshot, markViewed, searchCompanies, type Company } from "@/lib/data/companies";
import { feedCounts, getFeed } from "@/lib/data/feed";
import { db } from "@/lib/db";
import { dayET, money } from "@/lib/time";
import { currentUser } from "@/lib/web/request";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ticker: string }> };

/** "/stock/AAPL", "/stock/brk-b", or "/stock/CIK1234567" for a company that has no ticker. */
async function find(raw: string): Promise<Company | null> {
  const text = decodeURIComponent(raw);
  const byCik = /^CIK0*(\d{1,10})$/i.exec(text);
  return byCik ? getCompanyByCik(db(), Number(byCik[1])) : getCompanyByTicker(db(), text);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const company = await find((await params).ticker).catch(() => null);
  if (!company) return { title: "Stock not found" };
  const name = company.ticker ? `${company.name} ($${company.ticker})` : company.name;
  return { title: `${name}: news, filings and health check`, description: `Every press release and SEC filing from ${company.name}, in one sentence, plus a health check from its SEC filings.` };
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

export default async function StockPage({ params }: Props) {
  const raw = (await params).ticker;
  const company = await find(raw);
  if (!company) {
    const text = decodeURIComponent(raw).slice(0, 20);
    const close = await searchCompanies(db(), text.replace(/[^A-Za-z]/g, "").slice(0, 4) || text, 3).catch(() => []);
    return (
      <Shell>
        <section className="wrap-narrow flex flex-col items-center gap-4 py-16 text-center">
          <h1 className="m-0 text-4xl font-extrabold tracking-[-0.03em]">Stock not found</h1>
          <p className="m-0 text-lg text-ink-2">No company with the ticker “{text.toUpperCase()}”.</p>
          {close.length > 0 && (
            <p className="m-0 text-base text-ink-2">
              Did you mean{" "}
              {close.map((c, i) => (
                <span key={c.cik}>{i > 0 && ", "}<Link href={`/stock/${encodeURIComponent(c.ticker!)}`} className="font-bold">${c.ticker} {titleCase(c.name)}</Link></span>
              ))}
              ?
            </p>
          )}
          <Link href="/" className="btn btn-dark btn-lg">Search for a stock</Link>
        </section>
      </Shell>
    );
  }
  const pool = db();
  const user = await currentUser();
  await markViewed(pool, company.cik).catch(() => {});
  const [snapshot, feed, counts, mine, alerts] = await Promise.all([
    getSnapshot(pool, company.cik).catch(() => null),
    getFeed(pool, { cik: company.cik, limit: 12 }).catch(() => ({ items: [], next: null })),
    feedCounts(pool, new Date(Date.now() - 365 * 86_400_000), company.cik).catch(() => undefined),
    user ? watchlistCiks(pool, user.id).catch(() => [] as number[]) : Promise.resolve([] as number[]),
    user ? alertCiks(pool, user.email).catch(() => [] as number[]) : Promise.resolve([] as number[]),
  ]);
  const tk = company.ticker ? `$${company.ticker}` : company.name;
  const name = titleCase(company.name);
  const facts = [
    company.exchange, company.industry ? titleCase(company.industry) : null,
    company.city ? `${titleCase(company.city)}${company.state ? `, ${company.state}` : ""}` : null,
    company.isEmergingGrowth ? "Emerging growth company" : null,
  ].filter(Boolean);
  const cash = snapshot?.ttm?.cash;
  const lastReport = snapshot?.health.quarters?.[snapshot.health.quarters.length - 1]?.filed ?? null;
  const about: [string, string][] = [
    ...(money(cash?.liquid) ? [["Cash and investments", money(cash!.liquid)!] as [string, string]] : []),
    ...(money(cash?.quarterlySpend) ? [["Cash used each quarter", money(cash!.quarterlySpend)!] as [string, string]] : []),
    ...(money(snapshot?.ttm?.revenue) ? [["Sales, last 12 months", money(snapshot!.ttm.revenue)!] as [string, string]] : []),
    ...(lastReport ? [["Last quarterly report", dayET(lastReport + "T12:00:00Z")] as [string, string]] : []),
    ["SEC company number (CIK)", String(company.cik).padStart(10, "0")],
  ];

  return (
    <Shell>
      <section className="wrap flex flex-wrap items-center gap-5 pb-5 pt-7">
        <Initials name={company.name} ticker={company.ticker} size={64} />
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1">
          <h1 className="m-0 text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] md:text-4xl">
            {name} {company.ticker && <span className="text-muted">${company.ticker}</span>}
          </h1>
          {facts.length > 0 && <span className="text-[15px] text-ink-2">{facts.join(" · ")}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!user && <a href="#alert" className="btn btn-brand btn-lg min-h-12">Get {tk} alerts</a>}
          <FollowButton cik={company.cik} ticker={company.ticker} signedIn={Boolean(user)} inList={mine.includes(company.cik) || alerts.includes(company.cik)} />
        </div>
      </section>

      {(!company.profileReady || !company.factsReady) && <div className="wrap pb-4"><Gathering cik={company.cik} /></div>}

      <section className="wrap flex flex-wrap gap-4 pb-5">
        <div className="card flex min-w-0 flex-[999_1_560px] flex-col gap-2 bg-inset p-4 md:p-5">
          <h2 className="m-0 text-sm font-bold text-ink-2">Price and chart</h2>
          {company.tvSymbol ? (
            <>
              <TradingViewWidget kind="symbol-info" symbol={company.tvSymbol} height={130} label={`${tk} price, from TradingView`} quiet />
              <TradingViewWidget kind="advanced-chart" symbol={company.tvSymbol} height={380} label={`${tk} price chart, from TradingView`} />
              <TradingViewCredit />
            </>
          ) : (
            <p className="m-0 py-10 text-center text-sm text-muted">No price chart: this company is not listed on an exchange we can chart.</p>
          )}
        </div>
        <HealthCard snapshot={snapshot} waiting={!company.factsReady} />
      </section>

      <section className="wrap flex flex-wrap items-start gap-5 pb-12">
        <div className="min-w-0 flex-[999_1_560px]">
          <FeedList
            initial={feed.items} next={feed.next} cik={company.cik} counts={counts} filters={["press", "earnings", "news", "insider"]} hideTicker paged
            title="News & filings" signedIn={Boolean(user)} following={alerts}
            emptyText={company.profileReady ? `Nothing from ${tk} in this category yet.` : "Gathering filings…"}
          />
        </div>
        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <SignupCard id="alert" title={`Know the second ${tk} posts`} text="Every press release and SEC filing, in one sentence. Plus our free daily pick."
            button={`Alert me on ${tk}`} source={`stock:${company.ticker ?? company.cik}`} cik={company.cik} ticker={company.ticker} signedInEmail={user?.email} />
          <section aria-labelledby="about-h" className="card flex flex-col gap-2.5 p-[22px]">
            <h2 id="about-h" className="m-0 text-base font-extrabold">About</h2>
            {company.industry && <p className="m-0 text-sm leading-normal text-ink-2">{titleCase(company.industry)}{company.city ? `, based in ${titleCase(company.city)}${company.state ? `, ${company.state}` : ""}` : ""}.</p>}
            <dl className="m-0 flex flex-col">
              {about.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-t border-line-soft py-2 text-sm">
                  <dt className="text-muted">{k}</dt>
                  <dd className="num m-0 font-bold">{v}</dd>
                </div>
              ))}
            </dl>
            {company.website && /^https?:\/\//.test(company.website) && (
              <a href={company.website} target="_blank" rel="noopener noreferrer nofollow" className="text-sm font-bold no-underline">Company website ↗</a>
            )}
            <span className="fine">From SEC filings.</span>
          </section>
        </aside>
      </section>
    </Shell>
  );
}
