import type { FeedItem, FeedKind, FeedResponse } from "./types";
import { cached } from "./http";
import { fetchFilingsForTicker, fetchLatestFilings } from "./edgar";
import { fetchPressReleases } from "./rss";
import { normalizeTicker } from "./tickers";
import { sampleEnabled, sampleItems } from "./sample";
import { db, hasDb } from "../db";

export type FeedQuery = {
  kind?: FeedKind | "all";
  ticker?: string | null;
  limit?: number;
  /** ISO timestamp: only items published before this (pagination cursor). */
  before?: string | null;
  /** Base form types, e.g. ["8-K","10-Q"]; amendments ("8-K/A") match too. */
  forms?: string[] | null;
  /** Keyword search in titles / company names. */
  q?: string | null;
};
type Q = { kind: FeedKind | "all"; ticker: string | null; limit: number; before: string | null; forms: string[] | null; q: string | null };

const baseForm = (f: string | null) => (f ?? "").split("/")[0].toUpperCase();
const escapeLike = (w: string) => w.replace(/[%_\\]/g, (c) => "\\" + c);

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

function matches(i: FeedItem, q: Q): boolean {
  if (q.kind !== "all" && i.kind !== q.kind) return false;
  if (q.ticker && i.ticker !== q.ticker) return false;
  if (q.before && !(i.publishedAt < q.before)) return false;
  if (q.forms && !(i.kind === "filing" && q.forms.includes(baseForm(i.formType)))) return false;
  if (q.q) {
    const hay = `${i.title} ${i.company ?? ""} ${i.ticker ?? ""}`.toLowerCase();
    if (!q.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const filter = (items: FeedItem[], q: Q) => items.filter((i) => matches(i, q)).slice(0, q.limit);

async function fromDb(q: Q): Promise<FeedItem[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.kind !== "all") { args.push(q.kind); where.push(`kind = $${args.length}`); }
  if (q.ticker) { args.push(q.ticker); where.push(`ticker = $${args.length}`); }
  if (q.before) { args.push(q.before); where.push(`published_at < $${args.length}`); }
  if (q.forms) { args.push(q.forms); where.push(`kind = 'filing' AND upper(split_part(form_type, '/', 1)) = ANY($${args.length})`); }
  if (q.q) {
    for (const w of q.q.split(/\s+/).slice(0, 6)) {
      args.push(`%${escapeLike(w)}%`);
      const n = args.length;
      where.push(`(title ILIKE $${n} OR company ILIKE $${n} OR ticker ILIKE $${n})`);
    }
  }
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
  const before = query.before && Number.isFinite(Date.parse(query.before)) ? new Date(query.before).toISOString() : null;
  const forms = query.forms?.map((f) => f.trim().toUpperCase()).filter((f) => /^[A-Z0-9 -]{1,14}$/.test(f)) ?? [];
  const q: Q = {
    kind: query.kind ?? "all",
    ticker: normalizeTicker(query.ticker),
    limit: Math.min(Math.max(query.limit ?? 8, 1), 50),
    before,
    forms: forms.length ? forms : null,
    q: query.q?.trim().slice(0, 80) || null,
  };
  const done = (items: FeedItem[], mode: FeedResponse["mode"]): FeedResponse => ({
    items,
    mode,
    nextBefore: items.length === q.limit ? items[items.length - 1].publishedAt : null,
  });

  if (sampleEnabled()) return done(filter(sampleItems(), q), "sample");

  let base: FeedItem[] = [];
  let mode: FeedResponse["mode"] = "live";
  if (hasDb()) {
    try { base = await fromDb(q); mode = "db"; } catch (e) { console.warn("[feed] db", (e as Error).message); }
  }
  // Empty database (worker not run yet): fall back to fetching live.
  if (mode !== "db" || (base.length === 0 && !q.ticker && !q.q && !q.before && !q.forms)) {
    base = filter(await liveCached(), q);
    mode = "live";
  }

  // Ticker pages: also pull that company's filings straight from SEC.
  if (q.ticker && q.kind !== "press" && !q.q) {
    const extra = (await fetchFilingsForTicker(q.ticker, 60).catch(() => [])).filter((i) => matches(i, q));
    const seen = new Set(base.map((i) => i.url));
    base = [...base, ...extra.filter((i) => !seen.has(i.url))].sort(byNewest).slice(0, q.limit);
  }
  return done(base, mode);
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
