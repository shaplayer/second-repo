import Link from "next/link";
import { FeedRows } from "@/components/feed/FeedRows";
import { SignupCard } from "@/components/signup/SignupCard";
import { Shell } from "@/components/site/Shell";
import { TradingViewCredit, TradingViewWidget } from "@/components/tv/TradingViewWidget";
import { Initials, TypeBadge } from "@/components/ui/Badges";
import { getCompanyByCik, getSnapshot } from "@/lib/data/companies";
import { getFeed, getOriginalText, type FeedItem } from "@/lib/data/feed";
import { db } from "@/lib/db";
import { formMeaning, formWithCode, itemLabels } from "@/lib/plain";
import { dayET, exactET } from "@/lib/time";
import { currentUser } from "@/lib/web/request";
import { CopyLink, SummaryBody, SummaryLoader } from "./ItemClient";

/** The page for one filing or one press release: the summary first, then the way to the original. */
export async function ItemPage({ item }: { item: FeedItem }) {
  const pool = db();
  const user = await currentUser();
  const [company, snapshot, more, original] = await Promise.all([
    item.cik ? getCompanyByCik(pool, item.cik).catch(() => null) : null,
    item.cik ? getSnapshot(pool, item.cik).catch(() => null) : null,
    item.cik ? getFeed(pool, { cik: item.cik, limit: 6 }).then((p) => p.items.filter((i) => i.id !== item.id).slice(0, 5)).catch(() => []) : [],
    getOriginalText(pool, item.id).catch(() => null),
  ]);
  const tk = item.ticker ? `$${item.ticker}` : item.company;
  const stock = item.ticker ? `/stock/${encodeURIComponent(item.ticker)}` : item.cik ? `/stock/CIK${item.cik}` : null;
  const sections = itemLabels(item.items);
  const meaning = item.formCode ? formMeaning(item.formCode, { listed: Boolean(company?.exchange) }) : null;
  const opening = original ? original.text.slice(0, 700) : "";

  return (
    <Shell>
      <nav aria-label="Breadcrumb" className="wrap flex flex-wrap gap-1.5 pt-3 text-sm text-muted">
        {stock ? <Link href={stock} className="font-bold no-underline">{tk}</Link> : <span className="font-bold">{tk}</span>}
        <span aria-hidden="true">›</span><span>News &amp; filings</span>
        <span aria-hidden="true">›</span><span>{item.typeLabel}, {dayET(item.publishedAt)}</span>
      </nav>

      <div className="wrap flex flex-wrap items-start gap-6 pb-12 pt-5">
        <article className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px]">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <TypeBadge category={item.category} label={item.typeLabel} className="px-2.5 py-[3px] text-xs" />
            <span>{item.sourceName} · {exactET(item.publishedAt)}</span>
          </div>
          <h1 className="m-0 text-[28px] font-extrabold leading-[1.12] tracking-[-0.03em] md:text-[40px]">{item.headline}</h1>
          {meaning && (
            <p className="m-0 text-[15px] leading-normal text-ink-2">
              <strong>{item.formCode ? formWithCode(item.formCode, { listed: Boolean(company?.exchange) }) : item.typeLabel}:</strong> {meaning}
              {sections.length > 0 && <> This one covers: {sections.join("; ").toLowerCase()}.</>}
            </p>
          )}

          <section aria-label="Summary" className="card-mint flex flex-col gap-3 px-6 py-[22px]">
            {item.summary ? (
              <SummaryBody summary={item.summary} />
            ) : item.canSummarize ? (
              <SummaryLoader id={item.id} originalUrl={item.originalUrl} sourceName={item.sourceName} />
            ) : (
              <p className="m-0 text-base leading-normal text-ink-2">
                {item.sourceName} doesn&apos;t let us summarize its releases, so here is the headline and the link to the original.
              </p>
            )}
          </section>

          <div className="flex flex-wrap gap-2.5">
            <a href={item.originalUrl} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-lg min-h-12">Read the original on {item.sourceName} ↗</a>
            {original?.exhibitUrl && (
              <a href={original.exhibitUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-lg min-h-12 text-[15px] font-bold">The press release on SEC.gov ↗</a>
            )}
            <CopyLink />
          </div>

          {original && (
            <section aria-labelledby="orig-h" className="card flex flex-col gap-2.5 px-6 py-[22px]">
              <h2 id="orig-h" className="m-0 text-[17px] font-extrabold">Original text</h2>
              {original.text.length > 760 ? (
                <details className="group">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <p className="m-0 whitespace-pre-line text-[15px] leading-[1.65] text-ink-2 group-open:hidden">{opening}…</p>
                    <span className="btn btn-soft mt-2.5 group-open:hidden">Show the full release</span>
                    <span className="btn btn-soft hidden group-open:inline-flex">Show less</span>
                  </summary>
                  <p className="m-0 mt-3 whitespace-pre-line text-[15px] leading-[1.65] text-ink-2">{original.text}</p>
                </details>
              ) : (
                <p className="m-0 whitespace-pre-line text-[15px] leading-[1.65] text-ink-2">{original.text}</p>
              )}
            </section>
          )}

          {more.length > 0 && (
            <section aria-labelledby="more-h" className="flex flex-col">
              <h2 id="more-h" className="m-0 mb-1.5 text-[17px] font-extrabold">More from {tk}</h2>
              <FeedRows items={more} hideTicker />
            </section>
          )}
        </article>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          {stock && (
            <Link href={stock} className="card flex items-center gap-3.5 p-5 text-ink no-underline hover:bg-inset hover:text-ink">
              <Initials name={item.company} ticker={item.ticker} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <strong className="text-base">{item.company}</strong>
                <span className="text-[13px] text-muted">
                  {tk}{snapshot?.verdict && <> · Health check <strong className={snapshot.verdict === "Strong" ? "text-good" : snapshot.verdict === "Mixed" ? "text-amber" : "text-bad"}>{snapshot.verdict}</strong></>} · See stock page →
                </span>
              </span>
            </Link>
          )}
          {company?.tvSymbol && (
            <div className="card flex flex-col gap-2 bg-inset p-4">
              <span className="text-sm font-bold">{tk} today</span>
              <TradingViewWidget kind="mini-symbol-overview" symbol={company.tvSymbol} height={150} label={`${tk} price chart, from TradingView`} />
              <TradingViewCredit />
            </div>
          )}
          {item.cik && (
            <SignupCard title={`Get the next ${tk} news first`} button={`Alert me on ${tk}`} source={`item:${item.ticker ?? item.cik}`}
              cik={item.cik} ticker={item.ticker} signedInEmail={user?.email} />
          )}
        </aside>
      </div>
    </Shell>
  );
}
