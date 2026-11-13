/**
 * Press releases from the newswires' public RSS feeds. Only sources switched on in
 * public.news_sources are read, and the release's text is kept only where that table says we may.
 *
 * These are not SEC requests: they use their own, plainly named User-Agent and never the SEC client.
 * A feed that refuses us (403 or 429) is left alone for half an hour; the reader is never disguised.
 */
import { normalizeTicker } from "../sec/companies";
import { shortError, type Db } from "./db";
import { parsePressRss, type PressItem } from "./rss";

/** source = public.news_sources.key */
export const PRESS_FEEDS: { source: string; url: string }[] = [
  { source: "prnewswire", url: "https://www.prnewswire.com/rss/news-releases-list.rss" },
  { source: "prnewswire", url: "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss" },
  { source: "businesswire", url: "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeGVtRWA==" },
  {
    source: "globenewswire",
    url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
  },
  { source: "accessnewswire", url: "https://www.accessnewswire.com/newsroom/api/rss" },
];

function siteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w./-]*)?$/i.test(raw) ? raw : "https://bigstocks.com";
}
/** Says plainly who is reading the feed and where to find us. */
export const PRESS_USER_AGENT = `BigStocksBot/1.0 (+${siteUrl()})`;

export const PRESS_TIMEOUT_MS = 15_000;
const BACKOFF_MS = 30 * 60_000;
const MAX_TITLE_CHARS = 500;
/** host -> the time until which we do not ask it again */
const refusedUntil = new Map<string, number>();
/** Forgets which feeds refused us (tests only). */
export const resetPressBackoff = () => refusedUntil.clear();

export type PressOptions = {
  fetch?: typeof fetch;
  /** The feeds to read (default: PRESS_FEEDS). */
  feeds?: { source: string; url: string }[];
  now?: () => number;
};

async function readFeed(url: string, doFetch: typeof fetch, now: () => number): Promise<string> {
  const host = new URL(url).host;
  const until = refusedUntil.get(host) ?? 0;
  if (until > now()) throw new Error(`${host} refused us recently; not asking again until ${new Date(until).toISOString()}`);
  const res = await doFetch(url, {
    headers: {
      "User-Agent": PRESS_USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
    signal: AbortSignal.timeout(PRESS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    refusedUntil.set(host, now() + (retryAfter > 0 ? Math.max(retryAfter * 1000, 60_000) : BACKOFF_MS));
    throw new Error(`${host} answered ${res.status}; leaving it alone for a while`);
  }
  if (!res.ok) throw new Error(`${host} answered ${res.status}`);
  return res.text();
}

export async function pollPressFeeds(db: Db, opts: PressOptions = {}): Promise<{ sources: number; newItems: number[] }> {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const feeds = opts.feeds ?? PRESS_FEEDS;
  const { rows: sources } = await db.query<{ key: string; can_store_body: boolean }>(
    `select key, can_store_body from public.news_sources where enabled and key <> 'sec' and key = any($1::text[]) order by key`,
    [[...new Set(feeds.map((f) => f.source))]],
  );

  const newItems: number[] = [];
  for (const source of sources) {
    const items = new Map<string, PressItem>();
    for (const feed of feeds.filter((f) => f.source === source.key)) {
      try {
        for (const item of parsePressRss(await readFeed(feed.url, doFetch, now))) if (!items.has(item.url)) items.set(item.url, item);
      } catch (e) {
        // One feed failing never stops the others.
        console.warn(`[press] ${source.key}: ${feed.url}: ${shortError(e)}`);
      }
    }
    if (!items.size) continue;

    // Which company each ticker belongs to. A ticker from a market outside the US is never matched.
    const tickers = new Set<string>();
    for (const it of items.values()) {
      const t = it.usListed ? normalizeTicker(it.ticker) : null;
      if (t) tickers.add(t);
    }
    const company = new Map<string, { cik: number; name: string }>();
    if (tickers.size) {
      const { rows } = await db.query<{ ticker: string; cik: string; name: string }>(
        `select ct.ticker, ct.cik, c.name from public.company_tickers ct join public.companies c on c.cik = ct.cik
          where ct.ticker = any($1::text[])`,
        [[...tickers]],
      );
      for (const r of rows) company.set(r.ticker, { cik: Number(r.cik), name: r.name });
    }

    const rows = [...items.values()].map((it) => {
      const match = it.usListed ? company.get(normalizeTicker(it.ticker) ?? "") : undefined;
      return {
        cik: match?.cik ?? null,
        ticker: it.ticker,
        company_name: match?.name ?? it.company,
        title: it.title.slice(0, MAX_TITLE_CHARS),
        url: it.url,
        published_at: it.publishedAt,
        body_text: source.can_store_body && it.description ? it.description : null,
      };
    });
    const inserted = await db.query<{ id: string }>(
      `insert into public.news (source, cik, ticker, company_name, title, url, published_at, body_text)
       select $1, x.cik, x.ticker, x.company_name, x.title, x.url, least(x.published_at, now()), x.body_text
         from jsonb_to_recordset($2::jsonb)
           as x(cik bigint, ticker text, company_name text, title text, url text, published_at timestamptz, body_text text)
       on conflict (url) do nothing
       returning id`,
      [source.key, JSON.stringify(rows)],
    );
    for (const r of inserted.rows) newItems.push(Number(r.id));
  }
  return { sources: sources.length, newItems };
}
