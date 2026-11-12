import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PriceChart from "@/components/PriceChart";
import Tabs from "@/components/Tabs";
import AlertButton from "@/components/AlertButton";
import Chat from "@/components/Chat";
import PickCard from "@/components/PickCard";
import FilingSummary from "@/components/FilingSummary";
import WatchButton from "@/components/WatchButton";
import { dailyBars, liveQuote, toDbSymbol, type Quote } from "@/lib/databento";
import { big, money, pct, signed, upDown } from "@/lib/format";
import { fundamentals, type Fundamentals } from "@/lib/fundamentals";
import { categoryOf, explain, isAnnouncement, type PlainFiling } from "@/lib/plain";
import { lookup, recentFilings, submissions, type Submissions } from "@/lib/sec";
import { getAccount } from "@/lib/account";
import { picksWithResults } from "@/lib/picks";
import { summariesFor, type Summary } from "@/lib/store";
import { etParts, fmtWhen } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return { title: `${decodeURIComponent(ticker).toUpperCase()} · BigStocks` };
}

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await params).ticker).toUpperCase();
  const db = toDbSymbol(ticker);
  const co = await lookup(ticker).catch(() => null);

  const [daily, sub, facts, filings] = await Promise.all([
    dailyBars([db]).then((m) => m.get(db) ?? []).catch(() => []),
    co ? submissions(co.cik).catch(() => null) : null,
    co ? fundamentals(co.cik).catch(() => null) : null,
    co ? recentFilings(co.cik).catch(() => []) : [],
  ]);
  const [summaries, picks] = await Promise.all([
    summariesFor(filings.slice(0, 60).map((f) => f.accession)).catch(() => ({}) as Record<string, Summary>),
    picksWithResults(ticker).catch(() => []),
  ]);
  const me = picks.some((p) => p.tier === "members") ? await getAccount().catch(() => null) : null;
  if (!co && !daily.length) notFound();

  const quote = daily.length ? await liveQuote(db, daily).catch(() => null) : null;
  const plain = filings
    .map(explain)
    .filter((f): f is PlainFiling => f !== null)
    .map((f) => ({ ...f, summary: summaries[f.accession] ?? null }));
  const name = co?.name ?? ticker;
  const verdict = facts?.score?.verdict;

  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link> › {ticker}
      </div>
      <div className="s-head">
        <div style={{ display: "grid", gap: 6 }}>
          <span className="label">
            {co?.exchange ?? "US"}: {ticker}
          </span>
          <h1>{name}</h1>
        </div>
        {quote && (
          <div style={{ display: "grid", gap: 4 }}>
            <span className="price">{money(quote.price)}</span>
            <span className={`num ${upDown(quote.change)}`}>
              {signed(quote.change)} ({pct(quote.changePct)}){" "}
              {verdict && <span className={`pill v-${verdict}`} style={{ marginLeft: 6 }}>{verdict}</span>}
            </span>
            <span className="small muted">{asOfLabel(quote.asOf)}</span>
          </div>
        )}
        <div className="s-actions">
          {co && <AlertButton ticker={ticker} />}
          <WatchButton ticker={ticker} />
        </div>
      </div>
      {picks.length > 0 && (
        <div className="pick-grid" style={{ marginBottom: 16 }}>
          {picks.slice(0, 2).map((p) => (
            <PickCard key={p.id} p={p} locked={p.kind === "pick" && p.tier === "members" && !me?.isMember} />
          ))}
        </div>
      )}
      <Suspense>
        <Tabs
          tabs={[
            { id: "overview", label: "Overview", body: <Overview ticker={ticker} quote={quote} facts={facts} daily={daily.map((b) => b.c).slice(-252)} plain={plain} /> },
            { id: "filings", label: "Filings", body: <FilingList ticker={ticker} items={plain.slice(0, 40)} /> },
            { id: "contact", label: "Contact", body: <Contact sub={sub} cik={co?.cik} plain={plain} /> },
            { id: "chat", label: "Chat", body: <Chat ticker={ticker} /> },
            { id: "level2", label: "Level 2", badge: "SOON", body: <LevelTwo /> },
          ]}
        />
      </Suspense>
    </>
  );
}

/** "At close · Oct 9" once the session is over, otherwise "As of 11:42 AM ET". */
function asOfLabel(iso: string) {
  const d = new Date(iso);
  if (iso.includes("T00:00:00")) return `At close · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  const { hour, minute } = etParts(d);
  const sessionOver = hour * 60 + minute >= 15 * 60 + 59 || etParts(new Date()).date !== etParts(d).date;
  return sessionOver ? `At close · ${fmtWhen(d, true)}` : `As of ${fmtWhen(d)} · may be delayed`;
}

function Overview({ ticker, quote, facts, daily, plain }: { ticker: string; quote: Quote | null; facts: Fundamentals | null; daily: number[]; plain: Row[] }) {
  const rawCap = quote && facts?.sharesOutstanding ? quote.price * facts.sharesOutstanding : null;
  // Some companies (e.g. Berkshire) report share counts we can't price directly; hide values that can't be right.
  const cap = rawCap && facts?.ttmRevenue && rawCap / facts.ttmRevenue < 0.05 ? null : rawCap;
  const pe = cap && facts?.ttmProfit && facts.ttmProfit > 0 ? (cap / facts.ttmProfit).toFixed(1) : "—";
  const yieldPct = quote && facts?.ttmDividendPerShare ? ((facts.ttmDividendPerShare / quote.price) * 100).toFixed(2) + "%" : "None";
  const lo = daily.length ? Math.min(...daily) : null;
  const hi = daily.length ? Math.max(...daily) : null;
  const stats: [string, string][] = [
    ["Company value", big(cap)],
    ["Price vs. earnings (P/E)", pe],
    ["Sales, last 12 months", big(facts?.ttmRevenue)],
    ["Profit, last 12 months", big(facts?.ttmProfit)],
    ["Dividend yield", yieldPct],
    ["1-year range", lo !== null && hi !== null ? `${money(lo)} – ${money(hi)}` : "—"],
  ];
  const news = plain.filter(isAnnouncement).slice(0, 5);

  return (
    <>
      <div className="two">
        <div className="col">
          <PriceChart symbol={ticker} />
          <section className="panel">
            <div className="stats" style={{ marginTop: -1 }}>
              {stats.map(([k, v]) => (
                <div key={k} className="stat">
                  <span className="label">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <ScoreCard facts={facts} />
      </div>
      <section className="panel">
        <header>
          <h2>Latest announcements</h2>
          <span className="small muted">Straight from the company’s SEC filings</span>
        </header>
        <FilingRows ticker={ticker} items={news} />
      </section>
    </>
  );
}

function ScoreCard({ facts }: { facts: Fundamentals | null }) {
  const s = facts?.score;
  if (!s)
    return (
      <section className="panel answer">
        <div className="verdict">
          <span className="label">The answer · fundamentals</span>
          <span className="big muted">No score</span>
          <p style={{ margin: 0 }} className="muted">
            We need at least two years of quarterly reports to score this stock. Funds and very new companies don’t have them.
          </p>
        </div>
      </section>
    );
  return (
    <section className={`panel answer`}>
      <div className={`verdict v-${s.verdict}`} style={{ borderRadius: "12px 12px 0 0" }}>
        <span className="label">The answer · fundamentals</span>
        <span className="big">{s.verdict}</span>
        <span className="num small">
          {s.passed} of {s.answered} checks passed
        </span>
        <p style={{ margin: 0 }}>{s.summary}</p>
      </div>
      <div className="checks">
        <div className="check">
          <span className="label">Last 4 quarters</span>
          <span className="qs">
            {s.quarters.map((q) => (
              <span key={q} className="q h">
                {q}
              </span>
            ))}
          </span>
        </div>
        {s.checks.map((c) => (
          <div key={c.name} className="check">
            <span>{c.name}</span>
            <span className="qs">
              {c.results.map((r, i) => (
                <span key={i} className={`q ${r === null ? "u" : r ? "y" : "n"}`} title={`${s.quarters[i]}: ${r === null ? "not reported" : r ? "yes" : "no"}`}>
                  {r === null ? "–" : r ? "✓" : "✕"}
                </span>
              ))}
            </span>
          </div>
        ))}
        <p className="disc" style={{ margin: "8px 0 0" }}>
          Strong = 75%+ of checks passed, Mixed = 50–74%, Weak = under 50%. Based only on reported results. Not investment
          advice.
        </p>
      </div>
    </section>
  );
}

type Row = PlainFiling & { summary: Summary | null };

function FilingRows({ ticker, items }: { ticker: string; items: Row[] }) {
  if (!items.length) return <div className="empty">No filings found.</div>;
  return (
    <div className="rows">
      {items.map((f) => (
        <div key={f.accession} className="filing">
          <span className="meta">
            <span className={`imp ${f.importance}`}>{f.importance}</span>
            <span className="num">{fmtWhen(new Date(f.accepted), f.dateOnly)}</span>
            <span>Official name: {f.form}</span>
            <a href={f.url} target="_blank" rel="noreferrer">
              Original ↗
            </a>
          </span>
          <strong>{f.title}</strong>
          {!f.summary && <span className="small muted">{f.meaning}</span>}
          {(f.summary || categoryOf(f)) && <FilingSummary ticker={ticker} accession={f.accession} initial={f.summary} />}
        </div>
      ))}
    </div>
  );
}

function FilingList({ ticker, items }: { ticker: string; items: Row[] }) {
  return (
    <section className="panel">
      <header>
        <h2>Filings, in plain English</h2>
        <span className="small muted">Every official SEC filing. Click one to read the original.</span>
      </header>
      <FilingRows ticker={ticker} items={items} />
    </section>
  );
}

function Contact({ sub, cik, plain }: { sub: Submissions | null; cik?: number; plain: PlainFiling[] }) {
  const a = sub?.addresses.business;
  const annual = plain.find((f) => f.form === "10-K" || f.form === "20-F" || f.form === "40-F");
  const meeting = plain.find((f) => f.form === "DEF 14A");
  const site = sub?.investorWebsite || sub?.website;
  return (
    <div className="two" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      <section className="panel">
        <header>
          <h2>Talk to the company</h2>
        </header>
        <div className="rows">
          <div className="kv">
            <span className="label">Main phone</span>
            <span className="num">{sub?.phone || "Not listed"}</span>
          </div>
          {a && (
            <div className="kv">
              <span className="label">Headquarters</span>
              <span>
                {[a.street1, a.street2].filter(Boolean).join(", ")}
                <br />
                {a.city}, {a.stateOrCountry} {a.zipCode}
              </span>
            </div>
          )}
          {site && (
            <div className="kv">
              <span className="label">Website</span>
              <a href={site.startsWith("http") ? site : `https://${site}`} target="_blank" rel="noreferrer">
                {site}
              </a>
            </div>
          )}
          <div className="kv">
            <span className="label">Can I talk to the CEO?</span>
            <span>
              Usually not directly. Call the main number and ask for <strong>Investor Relations</strong>, ask your question at
              the annual shareholder meeting, or listen to the next earnings call, where the CEO answers questions.
            </span>
          </div>
        </div>
      </section>
      <section className="panel">
        <header>
          <h2>Reports and meetings</h2>
        </header>
        <div className="rows">
          <div className="kv">
            <span className="label">Latest annual report</span>
            {annual ? (
              <a href={annual.url} target="_blank" rel="noreferrer">
                Read it online · filed {fmtWhen(new Date(annual.accepted), annual.dateOnly)}
              </a>
            ) : (
              <span className="muted">Not found</span>
            )}
            <span className="small muted">Want it printed? Investor Relations will mail shareholders a copy for free.</span>
          </div>
          <div className="kv">
            <span className="label">Shareholder meeting</span>
            {meeting ? (
              <a href={meeting.url} target="_blank" rel="noreferrer">
                Latest meeting notice · filed {fmtWhen(new Date(meeting.accepted), meeting.dateOnly)}
              </a>
            ) : (
              <span className="muted">No recent notice</span>
            )}
          </div>
          {cik && (
            <div className="kv">
              <span className="label">All official filings</span>
              <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`} target="_blank" rel="noreferrer">
                Company page on SEC.gov
              </a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function LevelTwo() {
  return (
    <section className="panel">
      <div className="coming">
        <span className="label">Level 2 · coming next</span>
        <h2>See every buyer and seller, live</h2>
        <p className="muted" style={{ margin: 0 }}>
          The real-time order book and historical time &amp; sales, explained in plain English. It launches with a free trial.
        </p>
      </div>
    </section>
  );
}
