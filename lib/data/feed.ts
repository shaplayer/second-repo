/**
 * The news feed: SEC filings and press releases as one list, newest first. Pages and APIs read this;
 * nothing here ever calls the SEC or any other outside service (plan §3: pages read the database only).
 *
 * A feed item is either a filing ("f:<accession>") or a press release from a newswire or other
 * source ("n:<id>"). A press release that a company attached to a filing is not a separate item:
 * it gives that filing its headline.
 */
import type { Pool, PoolClient, Client } from "pg";
import { CATEGORIES, formLabel, plainHeadline, PRESS_LABEL, type Category } from "../plain";

type Db = Pool | PoolClient | Client;

export type FeedSummary = {
  /** 'ai' = written by Claude (must be labelled as AI-generated); 'rule' = built from the filing's own data. */
  kind: "ai" | "rule";
  oneSentence: string;
  bullets: string[];
};

export type FeedItem = {
  /** "f:0000320193-26-000018" or "n:123" */
  id: string;
  kind: "filing" | "release";
  cik: number | null;
  ticker: string | null;
  company: string;
  category: Category;
  /** "Quarterly report", "Company news", "Insider trade", "Press release"... */
  typeLabel: string;
  /** The official form code, for use in brackets only. Null for press releases. */
  formCode: string | null;
  /** "SEC.gov", "PR Newswire"... */
  sourceName: string;
  headline: string;
  /** ISO time the SEC accepted the filing, or the release was published. */
  publishedAt: string;
  /** This site's page for the item. */
  path: string;
  /** The original document on the source's own site. */
  originalUrl: string;
  summary: FeedSummary | null;
  /** False when the source does not let us summarize its text: show the headline and the link only. */
  canSummarize: boolean;
  /** This item's exact place in the feed. Pass it as `before` or `after` to page from here. */
  cursor: string;
};

export type FeedQuery = {
  /** One kind of news, or everything. */
  category?: Category;
  /** One company (the stock page). */
  cik?: number;
  /** Several companies ("My stocks only"). An empty list matches nothing. */
  ciks?: number[];
  /** Free text: a ticker, part of a company name, or part of a headline. */
  text?: string;
  /** Only items older than this one (paging: pass the last item's cursor). */
  before?: string;
  /** Only items newer than this one (the "3 new posts" check: pass the first item's cursor). */
  after?: string;
  limit?: number;
};

export type FeedPage = { items: FeedItem[]; /** Pass as `before` for the next page; null when there is no more. */ next: string | null };

type Row = {
  kind: "f" | "n";
  ref: string;
  at: string;
  /** The same time as text, to the microsecond: paging by a rounded time would skip items posted in the same millisecond. */
  at_exact: string;
  cik: string | null;
  ticker: string | null;
  company: string | null;
  listed: boolean;
  form: string | null;
  items: string[] | null;
  category: string;
  release_title: string | null;
  original_url: string;
  source_name: string;
  can_summarize: boolean;
  s_kind: "ai" | "rule" | null;
  s_headline: string | null;
  s_one: string | null;
  s_bullets: string[] | null;
};

/** A position in the feed: "<time to the microsecond>|<kind>|<ref>". */
export const cursorOf = (it: Pick<FeedItem, "cursor">) => it.cursor;

function parseCursor(cursor: string | undefined): { at: string; key: string } | null {
  if (!cursor) return null;
  const [at, kind, ...rest] = cursor.split("|");
  const ref = rest.join("|");
  if (!at || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/.test(at) || (kind !== "f" && kind !== "n") || !ref) return null;
  return { at, key: `${kind}:${ref}` };
}

export function toFeedItem(r: Row): FeedItem {
  const category = (CATEGORIES as readonly string[]).includes(r.category) ? (r.category as Category) : "news";
  const filing = r.kind === "f";
  const form = r.form ?? "";
  const fallback = filing ? r.release_title?.trim() || plainHeadline({ form, items: r.items }, { listed: r.listed }) : r.release_title ?? "";
  const summary: FeedSummary | null =
    r.s_kind && r.s_headline
      ? { kind: r.s_kind, oneSentence: r.s_one?.trim() || r.s_headline, bullets: r.s_bullets ?? [] }
      : null;
  return {
    id: `${r.kind}:${r.ref}`,
    kind: filing ? "filing" : "release",
    cik: r.cik === null ? null : Number(r.cik),
    ticker: r.ticker,
    company: r.company ?? "",
    category,
    typeLabel: filing ? formLabel(form, { listed: r.listed }) ?? "SEC filing" : PRESS_LABEL,
    formCode: filing ? form : null,
    sourceName: r.source_name,
    // A summary's headline says what happened; until there is one, the release's own title or the plain name of the filing.
    headline: r.s_headline?.trim() || fallback,
    publishedAt: new Date(r.at).toISOString(),
    path: filing ? `/filing/${r.ref}` : `/release/${r.ref}`,
    originalUrl: r.original_url,
    summary,
    canSummarize: r.can_summarize,
    cursor: `${r.at_exact}|${r.kind}|${r.ref}`,
  };
}

const EXACT = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const FILING_COLS = `'f' as kind, f.accession as ref, f.accepted_at as at, ${EXACT("f.accepted_at")} as at_exact, f.cik::text as cik, c.ticker, c.name as company,
  (c.exchange is not null) as listed, f.form, f.items, f.category, f.title as release_title, f.primary_url as original_url,
  'SEC.gov' as source_name, true as can_summarize, s.kind as s_kind, s.headline as s_headline, s.one_sentence as s_one, s.bullets as s_bullets`;
const RELEASE_COLS = `'n' as kind, n.id::text as ref, n.published_at as at, ${EXACT("n.published_at")} as at_exact, n.cik::text as cik, c.ticker, c.name as company,
  (c.exchange is not null) as listed, null::text as form, null::text[] as items, 'press' as category, n.title as release_title,
  n.url as original_url, src.name as source_name, src.can_summarize, s.kind as s_kind, s.headline as s_headline, s.one_sentence as s_one,
  s.bullets as s_bullets`;

/**
 * One page of the feed. Each half (filings, releases) is cut to the page size on its own index before
 * the two are merged, so the query stays fast however large the tables grow.
 */
export async function getFeed(db: Db, q: FeedQuery = {}): Promise<FeedPage> {
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const fWhere: string[] = ["f.category is not null"];
  const nWhere: string[] = ["n.source <> 'sec'"];
  let filings = true;
  let releases = true;

  if (q.category === "press") filings = false;
  else if (q.category) {
    releases = false;
    fWhere.push(`f.category = ${p(q.category)}`);
  }
  if (q.cik !== undefined) {
    const x = p(q.cik);
    fWhere.push(`f.cik = ${x}`);
    nWhere.push(`n.cik = ${x}`);
  }
  if (q.ciks !== undefined) {
    const x = p(q.ciks);
    fWhere.push(`f.cik = any(${x}::bigint[])`);
    nWhere.push(`n.cik = any(${x}::bigint[])`);
  }
  const text = q.text?.trim();
  if (text) {
    const like = p(`%${text.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    const exact = p(text.replace(/^\$/, "").toUpperCase());
    fWhere.push(`(c.ticker = ${exact} or c.name ilike ${like} or f.title ilike ${like} or s.headline ilike ${like})`);
    nWhere.push(`(c.ticker = ${exact} or c.name ilike ${like} or n.title ilike ${like})`);
  }
  const before = parseCursor(q.before);
  const after = parseCursor(q.after);
  if (before) {
    const at = p(before.at);
    const key = p(before.key);
    // The range test lets the index do the work; the pair test is the exact position (and must be applied before
    // each half is cut to the page size, or the item the cursor names would use up one of the places).
    fWhere.push(`f.accepted_at <= ${at}::timestamptz and (f.accepted_at, 'f:' || f.accession) < (${at}::timestamptz, ${key})`);
    nWhere.push(`n.published_at <= ${at}::timestamptz and (n.published_at, 'n:' || n.id::text) < (${at}::timestamptz, ${key})`);
  }
  if (after) {
    const at = p(after.at);
    const key = p(after.key);
    fWhere.push(`f.accepted_at >= ${at}::timestamptz and (f.accepted_at, 'f:' || f.accession) > (${at}::timestamptz, ${key})`);
    nWhere.push(`n.published_at >= ${at}::timestamptz and (n.published_at, 'n:' || n.id::text) > (${at}::timestamptz, ${key})`);
  }
  const n = p(limit + 1);
  // "Newer than" pages are read oldest-first so none are skipped, then shown newest-first.
  const dir = after && !before ? "asc" : "desc";
  const halves: string[] = [];
  if (filings) {
    halves.push(`(select ${FILING_COLS}
        from public.filings f join public.companies c on c.cik = f.cik left join public.summaries s on s.accession = f.accession
       where ${fWhere.join(" and ")} order by f.accepted_at ${dir}, f.accession ${dir} limit ${n})`);
  }
  if (releases) {
    halves.push(`(select ${RELEASE_COLS}
        from public.news n join public.news_sources src on src.key = n.source join public.companies c on c.cik = n.cik
        left join public.summaries s on s.news_id = n.id
       where ${nWhere.join(" and ")} order by n.published_at ${dir}, n.id ${dir} limit ${n})`);
  }
  if (!halves.length) return { items: [], next: null };
  const { rows } = await db.query<Row>(
    `select x.* from (${halves.join(" union all ")}) x
      order by x.at ${dir}, (x.kind || ':' || x.ref) ${dir} limit ${n}`,
    params,
  );
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map(toFeedItem);
  if (dir === "asc") items.reverse();
  return { items, next: more && dir === "desc" && items.length ? cursorOf(items[items.length - 1]) : null };
}

/** One item by its id ("f:<accession>" or "n:<id>"), or null. */
export async function getFeedItem(db: Db, id: string): Promise<FeedItem | null> {
  const [kind, ...rest] = id.split(":");
  const ref = rest.join(":");
  if (kind === "f" && /^\d{10}-\d{2}-\d{6}$/.test(ref)) {
    const { rows } = await db.query<Row>(
      `select ${FILING_COLS}
         from public.filings f join public.companies c on c.cik = f.cik left join public.summaries s on s.accession = f.accession
        where f.accession = $1`,
      [ref],
    );
    // A filing the site does not classify can still be opened directly (old links): treat it as company news.
    return rows[0] ? toFeedItem({ ...rows[0], category: rows[0].category ?? "news" }) : null;
  }
  if (kind === "n" && /^\d{1,18}$/.test(ref)) {
    const { rows } = await db.query<Row>(
      `select ${RELEASE_COLS}
         from public.news n join public.news_sources src on src.key = n.source left join public.companies c on c.cik = n.cik
         left join public.summaries s on s.news_id = n.id
        where n.id = $1 and n.source <> 'sec'`,
      [ref],
    );
    return rows[0] ? toFeedItem({ ...rows[0], company: rows[0].company ?? "" }) : null;
  }
  return null;
}

/** How many items each filter holds since a point in time (the counts on the filter buttons). */
export async function feedCounts(db: Db, since: Date, cik?: number): Promise<Record<Category | "all", number>> {
  const params: unknown[] = [since.toISOString()];
  const only = cik === undefined ? "" : ` and cik = $${params.push(cik)}`;
  const { rows } = await db.query<{ category: string; n: string }>(
    `select category, count(*) as n from public.filings where accepted_at >= $1 and category is not null${only} group by category
     union all
     select 'press', count(*) from public.news where published_at >= $1 and source <> 'sec' and cik is not null${only}`,
    params,
  );
  const out = { all: 0, press: 0, earnings: 0, news: 0, insider: 0, ipo: 0, proxy: 0 } as Record<Category | "all", number>;
  for (const r of rows) {
    if ((CATEGORIES as readonly string[]).includes(r.category)) out[r.category as Category] += Number(r.n);
    out.all += Number(r.n);
  }
  return out;
}
