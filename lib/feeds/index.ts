import type { FeedItem, FeedKind, FeedResponse } from "./types";
import { cached } from "./http";
import { fetchFilingsForTicker, fetchLatestFilings } from "./edgar";
import { fetchPressReleases } from "./rss";
import { normalizeTicker } from "./tickers";
import { sampleEnabled, sampleItems } from "./sample";
import { db, hasDb } from "../db";

export type FeedQuery = { kind?: FeedKind | "all"; ticker?: string | null; limit?: number };

const byNewest = (a: FeedItem, b: FeedItem) => b.publishedAt.localeCompare(a.publishedAt);

/** Fetch every source live (used by the ingest worker and as a no-DB fallback). */
export async function fetchAllLive(): Promise<FeedItem[]> {
  const [filings, press] = await Promise.all([
    fetchLatestFilings().catch((e) => { console.warn("[feed] filings", e?.message); return []; }),
    fetchPressReleases().catch((e) => { console.warn("[feed] press", e?.message); return []; }),
  ]);
  return [...filings, ...press].sort(byNewest);
}

const liveCached = () => cached("feed:live", 5 * 60 * 1000, fetchAllLive);

function filter(items: FeedItem[], q: Required<FeedQuery>): FeedItem[] {
  return items
    .filter((i) => q.kind === "all" || i.kind === q.kind)
    .filter((i) => !q.ticker || i.ticker === q.ticker)
    .slice(0, q.limit);
}

async function fromDb(q: Required<FeedQuery>): Promise<FeedItem[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.kind !== "all") { args.push(q.kind); where.push(`kind = $${args.length}`); }
  if (q.ticker) { args.push(q.ticker); where.push(`ticker = $${args.length}`); }
  args.push(q.limit);
  const { rows } = await db().query(
    `SELECT id, kind, ticker, company, title, url, source, form_type, published_at
       FROM news_items ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY published_at DESC LIMIT $${args.length}`,
    args,
  );
  return rows.map((r) => ({
    id: String(r.id), kind: r.kind, ticker: r.ticker, company: r.company, title: r.title,
    url: r.url, source: r.source, formType: r.form_type,
    publishedAt: new Date(r.published_at).toISOString(),
  }));
}

export async function getFeed(query: FeedQuery = {}): Promise<FeedResponse> {
  const q: Required<FeedQuery> = {
    kind: query.kind ?? "all",
    ticker: normalizeTicker(query.ticker),
    limit: Math.min(Math.max(query.limit ?? 8, 1), 50),
  };

  if (sampleEnabled()) return { items: filter(sampleItems(), q), mode: "sample" };

  let base: FeedItem[] = [];
  let mode: FeedResponse["mode"] = "live";
  if (hasDb()) {
    try { base = await fromDb(q); mode = "db"; } catch (e) { console.warn("[feed] db", (e as Error).message); }
  }
  if (mode !== "db" || (base.length === 0 && !q.ticker)) {
    base = filter(await liveCached(), q);
    mode = "live";
  }

  // Ticker search: also pull that company's filings straight from SEC.
  if (q.ticker && q.kind !== "press") {
    const extra = await fetchFilingsForTicker(q.ticker).catch(() => []);
    const seen = new Set(base.map((i) => i.url));
    base = [...base, ...extra.filter((i) => !seen.has(i.url))].sort(byNewest).slice(0, q.limit);
  }
  return { items: base, mode };
}

/** Upsert items into Postgres. Returns number of new rows. */
export async function saveItems(items: FeedItem[]): Promise<number> {
  let added = 0;
  for (const i of items) {
    const r = await db().query(
      `INSERT INTO news_items (kind, ticker, company, title, url, source, form_type, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (url) DO NOTHING`,
      [i.kind, i.ticker, i.company, i.title, i.url, i.source, i.formType, i.publishedAt],
    );
    added += r.rowCount ?? 0;
  }
  return added;
}
