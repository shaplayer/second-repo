import Link from "next/link";
import Chat from "@/components/Chat";
import LatestNews from "@/components/LatestNews";
import MarketTrends, { type TrendRow } from "@/components/MarketTrends";
import Watchlist from "@/components/Watchlist";
import { quoteFromDaily, recentDaily, toDbSymbol } from "@/lib/databento";
import { money, pct, upDown } from "@/lib/format";
import { companies } from "@/lib/sec";
import { MARKET_SUMMARY, TREND_UNIVERSE } from "@/lib/universe";

export const dynamic = "force-dynamic";

async function load() {
  const symbols = [...MARKET_SUMMARY.map((m) => m.symbol), ...TREND_UNIVERSE];
  const [bars, cos] = await Promise.all([recentDaily(symbols.map(toDbSymbol)), companies()]);
  const summary = MARKET_SUMMARY.map((m) => ({ ...m, quote: quoteFromDaily(m.symbol, bars.get(m.symbol)) }));
  const trends: TrendRow[] = TREND_UNIVERSE.flatMap((s) => {
    const q = quoteFromDaily(s, bars.get(toDbSymbol(s)));
    return q ? [{ symbol: s, name: cos.get(s)?.name ?? s, price: q.price, changePct: q.changePct, volume: q.volume }] : [];
  });
  const asOf = summary.find((s) => s.quote)?.quote?.asOf;
  return { summary, trends, asOf };
}

export default async function Home() {
  let data: Awaited<ReturnType<typeof load>> | null = null;
  let error = "";
  try {
    data = await load();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <>
      {error && <div className="err-box">Market data couldn’t load: {error}</div>}
      {data && (
        <>
          <div className="summary">
            {data.summary.map((m) => (
              <Link key={m.symbol} href={`/stock/${m.symbol}`} className="idx">
                <span className="n">{m.label}</span>
                <span className="num">{m.quote ? money(m.quote.price) : "—"}</span>
                {m.quote && <span className={`num small ${upDown(m.quote.changePct)}`}>{pct(m.quote.changePct)}</span>}
                <span className="small muted">{m.symbol} fund</span>
              </Link>
            ))}
          </div>
          {data.asOf && (
            <div className="asof">
              Market prices as of the close on{" "}
              {new Date(data.asOf).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}
            </div>
          )}
        </>
      )}
      <div className="home-grid">
        <div className="col">
          <Watchlist />
          <LatestNews />
        </div>
        <div className="col">
          {data && <MarketTrends rows={data.trends} />}
          <Chat compact />
        </div>
      </div>
    </>
  );
}
