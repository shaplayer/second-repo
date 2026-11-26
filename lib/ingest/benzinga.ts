/**
 * Benzinga News API adapter. The token is sent only in the API request and never included in logs.
 */
import { franc } from "franc";
import { normalizeTicker } from "../sec/companies";
import { htmlToText } from "../sec/text";
import { inTransaction } from "../alerts/subscriptions";
import { PRESS_USER_AGENT } from "./press";
import { isLawFirmNotice, type PressItem } from "./rss";
import type { Client, Pool, PoolClient } from "pg";

type Db = Pool | PoolClient | Client;

export const BENZINGA_API_URL = "https://api.benzinga.com/api/v2/news";
export const BENZINGA_PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const REFUSAL_BACKOFF_MS = 30 * 60_000;
const refusedUntil = new Map<string, number>();
/** Clears the in-memory refusal backoff between tests. */
export const resetBenzingaBackoff = () => refusedUntil.clear();

export type BenzingaOptions = {
  fetch?: typeof fetch;
  token?: string;
  now?: () => number;
};

const US_EXCHANGES = new Set([
  "AMEX", "ARCA", "BATS", "CBOE", "NASDAQ", "NASDAQCM", "NASDAQGM", "NASDAQGS",
  "NYSE", "NYSEAMERICAN", "NYSEARCA", "NYSEMKT", "OTC", "OTCPINK", "OTCQB", "OTCQX",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsExchange(value: unknown): boolean {
  return typeof value === "string" && US_EXCHANGES.has(value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
}

function articleTickers(stocks: unknown): string[] {
  if (!Array.isArray(stocks)) return [];
  const tickers = new Set<string>();
  for (const value of stocks) {
    if (!isRecord(value) || !isUsExchange(value.exchange) || typeof value.name !== "string") continue;
    const ticker = normalizeTicker(value.name);
    if (ticker) tickers.add(ticker);
  }
  return [...tickers];
}

export type BenzingaItem = PressItem & { tickers: string[]; sourceItemId: string | null; articleId: string | null };
const MARKET_MOVE = /\b(?:stocks?|shares?|trading|sectors?)\b.{0,80}\b(?:rises?|rose|rising|falls?|fell|falling|jumps?|jumped|jumping|surges?|surged|surging|plunges?|plunged|plunging|sliding|slides?|slid|drops?|dropped|dropping|lower|higher|gains?|gained|gaining|losses?|soars?|soared|soaring|sinks?|sank|sinking|outperforms?|underperforms?)\b|\b(?:rises?|rose|rising|falls?|fell|falling|jumps?|jumped|surges?|surged|plunges?|plunged|slides?|slid|drops?|dropped|sinks?|sank|outperforms?|underperforms?)\b.{0,80}\b(?:stocks?|shares?|trading|sectors?)\b/i;

function articleLanguage(title: string, body: string): "english" | "other" | "unknown" {
  const titleLanguage = franc(htmlToText(title), { minLength: 20 });
  const bodyLanguage = franc(body, { minLength: 80 });
  if (titleLanguage === "und" || bodyLanguage === "und") return "unknown";
  if (titleLanguage !== "eng" || bodyLanguage !== "eng") return "other";
  return "english";
}

/** Converts Benzinga's article array into the normalized shape shared by news sources. */
export function parseBenzingaNews(payload: unknown): BenzingaItem[] {
  if (!Array.isArray(payload)) throw new Error("Benzinga API response is not a news-item array");

  const out: BenzingaItem[] = [];
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  for (const value of payload) {
    if (!isRecord(value)) continue;
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const url = typeof value.url === "string" ? value.url.trim() : "";
    const tickers = articleTickers(value.stocks);
    const date = typeof value.created === "string" ? new Date(value.created) : null;
    if (!title || isLawFirmNotice(title) || /\b(?:buy|sell)\b/i.test(title) ||
        MARKET_MOVE.test(title) ||
        /\$\s*\d/.test(title) || !/^https:\/\/[^\s]+$/i.test(url) || !tickers.length || !date || !Number.isFinite(date.getTime())) continue;

    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch { continue; }
    const quote = parsedUrl.hostname.toLowerCase() === "www.benzinga.com" && /^\/quote\//i.test(parsedUrl.pathname);
    const id = typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0 ? String(value.id) : null;
    if (quote && !id) continue;
    const sourceItemId = quote ? id : null;
    const key = sourceItemId ? `id:${sourceItemId}` : `url:${url}`;
    if (seen.has(key) || (id && seenIds.has(id))) continue;

    const content = typeof value.body === "string" && value.body.trim()
      ? value.body
      : typeof value.teaser === "string" ? value.teaser : "";
    const description = htmlToText(content);
    const language = articleLanguage(title, description);
    if (language !== "english") {
      console.warn(`[benzinga] article skipped: ${title} ${description} Reason - language ${language}`);
      continue;
    }
    seen.add(key);
    if (id) seenIds.add(id);
    console.log(`[benzinga] article accepted: ${title}`);
    out.push({
      title,
      url,
      publishedAt: date.toISOString(),
      ticker: tickers[0],
      tickers,
      sourceItemId,
      articleId: id,
      usListed: true,
      company: null,
      description,
    });
  }
  return out;
}

function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(at - now, 0) : null;
}

export async function fetchBenzingaNews(opts: BenzingaOptions = {}): Promise<BenzingaItem[]> {
  const token = (opts.token ?? process.env.BENZINGA_API_TOKEN ?? "").trim();
  if (!token) throw new Error("BENZINGA_API_TOKEN is required while the Benzinga source is enabled");

  const now = opts.now ?? Date.now;
  const host = new URL(BENZINGA_API_URL).host;
  const until = refusedUntil.get(host) ?? 0;
  if (until > now()) throw new Error("Benzinga API recently refused the request; backing off before retrying");

  const url = new URL(BENZINGA_API_URL);
  url.searchParams.set("pageSize", String(BENZINGA_PAGE_SIZE));
  url.searchParams.set("displayOutput", "full");
  url.searchParams.set("topic_group_by", "or");
  url.searchParams.set("sort", "created:desc");
  url.searchParams.set("token", token);

  let response: Response;
  try {
    response = await (opts.fetch ?? fetch)(url, {
      headers: { "User-Agent": PRESS_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new Error("Benzinga API request failed before a response was received");
  }

  if (response.status === 403 || response.status === 429) {
    const retryAfter = retryAfterMs(response.headers.get("retry-after"), now());
    refusedUntil.set(host, now() + Math.max(retryAfter ?? 0, REFUSAL_BACKOFF_MS));
    throw new Error(`Benzinga API answered ${response.status}; backing off before retrying`);
  }
  if (!response.ok) throw new Error(`Benzinga API answered HTTP ${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Benzinga API returned invalid JSON");
  }
  return parseBenzingaNews(payload);
}

export async function pollBenzingaNews(
  db: Db,
  opts: BenzingaOptions = {},
): Promise<{ sources: number; newItems: number[] }> {
  const { rows } = await db.query<{ key: string; can_store_body: boolean }>(
    `select key, can_store_body from public.news_sources where key = 'benzinga' and enabled`,
  );
  const source = rows[0];
  if (!source) return { sources: 0, newItems: [] };

  const items = await fetchBenzingaNews(opts);
  return storeBenzingaNews(db, items);
}

/** Both the REST poller and stream serialize their writes, including company links. */
export async function storeBenzingaNews(
  db: Db,
  items: BenzingaItem[],
): Promise<{ sources: number; newItems: number[] }> {
  return inTransaction(db, async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext('bigstocks:benzinga:ingest'))`);
    const { rows } = await c.query<{ can_store_body: boolean }>(
      `select can_store_body from public.news_sources where key = 'benzinga' and enabled for share`,
    );
    const source = rows[0];
    if (!source) return { sources: 0, newItems: [] };
    if (!items.length) return { sources: 1, newItems: [] };
    const records = items.map((item) => ({
      url: item.url, source_item_id: item.sourceItemId, article_id: item.articleId, title: item.title.slice(0, 500),
      published_at: item.publishedAt, tickers: item.tickers,
      body_text: source.can_store_body && item.description ? item.description : null,
    }));
    const { rows: inserted } = await c.query<{ id: string }>(
      `with input as (
       select * from jsonb_to_recordset($1::jsonb)
         as x(url text, source_item_id text, article_id text, title text, published_at timestamptz, tickers jsonb, body_text text)
     ), resolved as (
       select i.*, (select ct.cik from jsonb_array_elements_text(i.tickers) with ordinality t(ticker, pos)
                      join public.company_tickers ct on ct.ticker = t.ticker order by t.pos limit 1) as cik,
              i.tickers->>0 as ticker
         from input i
     ), added as (
       insert into public.news (source, source_item_id, cik, ticker, company_name, title, url, published_at, body_text)
       select 'benzinga', r.source_item_id, r.cik, r.ticker, c.name, r.title, r.url, least(r.published_at, now()), r.body_text
         from resolved r left join public.companies c on c.cik = r.cik
        where not exists (select 1 from public.benzinga_articles b where b.article_id = r.article_id)
       on conflict do nothing returning id, url, source_item_id
     ), targets as (
       select a.id, i.article_id, i.tickers from added a join input i
         on (i.source_item_id is not null and a.source_item_id = i.source_item_id)
           or (i.source_item_id is null and a.source_item_id is null and a.url = i.url)
       union
       select n.id, i.article_id, i.tickers from public.news n join input i
         on n.source = 'benzinga' and
           ((i.source_item_id is not null and n.source_item_id = i.source_item_id)
             or (i.source_item_id is null and n.source_item_id is null and n.url = i.url))
       union
       select b.news_id, i.article_id, i.tickers from public.benzinga_articles b join input i on i.article_id = b.article_id
     ), identities as (
       insert into public.benzinga_articles (article_id, news_id)
       select distinct article_id, id from targets where article_id is not null
       on conflict do nothing returning article_id
     ), associations as (
       insert into public.news_companies (news_id, cik)
       select distinct n.id, ct.cik from targets n
         cross join lateral jsonb_array_elements_text(n.tickers) t(ticker)
         join public.company_tickers ct on ct.ticker = t.ticker
       on conflict do nothing returning news_id
     )
     select id::text from added`,
      [JSON.stringify(records)],
    );
    return { sources: 1, newItems: inserted.map((r) => Number(r.id)) };
  });
}
