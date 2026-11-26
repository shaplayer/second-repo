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
  /** The numbered sections of a "Company news" filing, e.g. ["2.02"]. Empty for everything else. */
  items: string[];
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
  /** Only items older than this page (pass the previous page's `next`). */
  before?: string;
  /** Only items newer than this one (the "3 new posts" check: pass the first item's cursor). */
  after?: string;
  limit?: number;
};

export type FeedPage = { items: FeedItem[]; /** Pass as `before` for the next page; null when there is no more. */ next: string | null };
export type FeedResult = FeedPage & {
  latestCursor: string | null;
  /** More items remain in the requested direction. */
  hasMore: boolean;
};

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
  source_key: string;
  source_name: string;
  can_summarize: boolean;
  s_kind: "ai" | "rule" | null;
  s_headline: string | null;
  s_one: string | null;
  s_bullets: string[] | null;
};

/** A position in the feed: "<time to the microsecond>|<kind>|<ref>". */
export const cursorOf = (it: Pick<FeedItem, "cursor">) => it.cursor;

function parseCursor(cursor: string | undefined): { at: string; key: string; excluded: string[] } | null {
  if (!cursor) return null;
  const [position, exclusions, ...extra] = cursor.split("~");
  if (extra.length) return null;
  const excluded = exclusions ? exclusions.split(",") : [];
  if (excluded.length > 100 || excluded.some((id) => !/^(?:f:\d{10}-\d{2}-\d{6}|n:\d{1,18})$/.test(id))) return null;
  const [at, kind, ...rest] = position.split("|");
  const ref = rest.join("|");
  if (!at || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/.test(at) || (kind !== "f" && kind !== "n") || !ref) return null;
  return { at, key: `${kind}:${ref}`, excluded };
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
    typeLabel: filing ? formLabel(form, { listed: r.listed }) ?? "SEC filing" : r.source_key === "benzinga" ? "News" : PRESS_LABEL,
    formCode: filing ? form : null,
    items: r.items ?? [],
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
  'sec' as source_key, 'SEC.gov' as source_name, true as can_summarize, s.kind as s_kind, s.headline as s_headline, s.one_sentence as s_one, s.bullets as s_bullets`;
const RELEASE_COLS = `'n' as kind, n.id::text as ref, n.published_at as at, ${EXACT("n.published_at")} as at_exact, c.cik::text as cik, c.ticker, c.name as company,
  (c.exchange is not null) as listed, null::text as form, null::text[] as items, 'press' as category, n.title as release_title,
  n.url as original_url, src.key as source_key, src.name as source_name, src.can_summarize, s.kind as s_kind, s.headline as s_headline, s.one_sentence as s_one,
  s.bullets as s_bullets`;

/**
 * The first page includes the latest item from each source active in the past day, then fills with
 * the newest remaining items. Later pages continue chronologically, excluding promoted items.
 */
export async function getFeed(db: Db, q: FeedQuery = {}): Promise<FeedResult> {
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const fWhere: string[] = ["f.category is not null"];
  const nWhere: string[] = ["n.source <> 'sec'"];
  let releaseCompany = "n.cik";
  let filings = true;
  let releases = true;

  if (q.category === "press") filings = false;
  else if (q.category) {
    releases = false;
    fWhere.push(`f.category = ${p(q.category)}`);
  }
  if (q.cik !== undefined) {
    const x = p(q.cik);
    releaseCompany = `${x}::bigint`;
    fWhere.push(`f.cik = ${x}`);
    nWhere.push(`(n.cik = ${x} or exists (select 1 from public.news_companies nc where nc.news_id = n.id and nc.cik = ${x}))`);
  }
  if (q.ciks !== undefined) {
    const x = p(q.ciks);
    if (q.cik === undefined) {
      releaseCompany = `coalesce((select nc.cik from public.news_companies nc where nc.news_id = n.id
        and nc.cik = any(${x}::bigint[]) order by (nc.cik = n.cik) desc, nc.cik limit 1), n.cik)`;
    }
    fWhere.push(`f.cik = any(${x}::bigint[])`);
    nWhere.push(`(n.cik = any(${x}::bigint[]) or exists (select 1 from public.news_companies nc where nc.news_id = n.id and nc.cik = any(${x}::bigint[])))`);
  }
  const text = q.text?.trim();
  if (text) {
    const like = p(`%${text.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    const exact = p(text.replace(/^\$/, "").toUpperCase());
    fWhere.push(`(c.ticker = ${exact} or c.name ilike ${like} or f.title ilike ${like} or s.headline ilike ${like})`);
    nWhere.push(`(c.ticker = ${exact} or c.name ilike ${like} or n.title ilike ${like}
      or exists (select 1 from public.news_companies nc join public.companies linked on linked.cik = nc.cik
                  where nc.news_id = n.id and (linked.name ilike ${like}
                    or exists (select 1 from public.company_tickers ct where ct.cik = nc.cik and ct.ticker = ${exact}))))`);
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
    if (before.excluded.length) {
      const excluded = p(before.excluded);
      fWhere.push(`('f:' || f.accession) <> all(${excluded}::text[])`);
      nWhere.push(`('n:' || n.id::text) <> all(${excluded}::text[])`);
    }
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
        from public.news n join public.news_sources src on src.key = n.source join public.companies c on c.cik = ${releaseCompany}
        left join public.summaries s on s.news_id = n.id
       where ${nWhere.join(" and ")} order by n.published_at ${dir}, n.id::text ${dir} limit ${n})`);
  }
  if (!halves.length) return { items: [], next: null, latestCursor: null, hasMore: false };
  const diversify = !q.before && !q.after;
  const candidates: string[] = [];
  if (diversify && filings) {
    candidates.push(`(select ${FILING_COLS}
      from public.filings f join public.companies c on c.cik = f.cik left join public.summaries s on s.accession = f.accession
      where ${fWhere.join(" and ")} and f.accepted_at >= now() - interval '24 hours'
      order by f.accepted_at desc, f.accession desc limit 1)`);
  }
  if (diversify && releases) {
    candidates.push(`(select best.* from public.news_sources src cross join lateral (
      select ${RELEASE_COLS}
      from public.news n join public.companies c on c.cik = ${releaseCompany}
      left join public.summaries s on s.news_id = n.id
      where ${nWhere.join(" and ")} and n.source = src.key and n.published_at >= now() - interval '24 hours'
      order by n.published_at desc, n.id::text desc limit 1
    ) best)`);
  }
  const { rows } = await db.query<Row & { promoted: boolean }>(
    `with base as (
      select x.* from (${halves.join(" union all ")}) x
      order by x.at ${dir}, (x.kind || ':' || x.ref) ${dir} limit ${n}
    )
    select base.*, false as promoted from base
    ${candidates.length ? `union all
      (select x.*, true as promoted from (${candidates.join(" union all ")}) x
       order by x.at desc, (x.kind || ':' || x.ref) desc limit ${n})` : ""}`,
    params,
  );
  const newestFirst = (a: FeedItem, b: FeedItem) => a.cursor === b.cursor ? 0 : a.cursor > b.cursor ? -1 : 1;
  const base = rows.filter((row) => !row.promoted).map(toFeedItem)
    .sort((a, b) => dir === "asc" ? newestFirst(b, a) : newestFirst(a, b));
  const promoted = rows.filter((row) => row.promoted).map(toFeedItem).sort(newestFirst);
  const selected = new Map<string, FeedItem>();
  for (const item of [...promoted, ...base]) {
    if (selected.size === limit) break;
    selected.set(item.id, item);
  }
  const items = [...selected.values()].sort(newestFirst);
  const firstOmitted = base.findIndex((item) => !selected.has(item.id));
  const more = firstOmitted !== -1;
  // The first missing chronological item, not the oldest promoted item, determines the next page.
  const boundary = more ? base[firstOmitted - 1] : undefined;
  const excluded = before?.excluded ?? promoted.filter((item) => boundary && item.cursor < boundary.cursor).map((item) => item.id);
  return {
    items,
    next: more && dir === "desc" && boundary
      ? `${cursorOf(boundary)}${excluded.length ? `~${excluded.join(",")}` : ""}` : null,
    latestCursor: items[0]?.cursor ?? null,
    hasMore: more,
  };
}

/** One item by its id ("f:<accession>" or "n:<id>"), or null. */
export async function getFeedItem(db: Db, id: string, companyCik?: number): Promise<FeedItem | null> {
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
         from public.news n join public.news_sources src on src.key = n.source left join public.companies c on c.cik =
           case when $2::bigint is not null and (n.cik = $2 or exists
             (select 1 from public.news_companies nc where nc.news_id = n.id and nc.cik = $2)) then $2 else n.cik end
         left join public.summaries s on s.news_id = n.id
        where n.id = $1 and n.source <> 'sec'`,
      [ref, companyCik ?? null],
    );
    return rows[0] ? toFeedItem({ ...rows[0], company: rows[0].company ?? "" }) : null;
  }
  return null;
}

/** How many items each filter holds since a point in time (the counts on the filter buttons). */
export async function feedCounts(db: Db, since: Date, cik?: number): Promise<Record<Category | "all", number>> {
  const params: unknown[] = [since.toISOString()];
  const only = cik === undefined ? "" : ` and cik = $${params.push(cik)}`;
  const newsOnly = cik === undefined ? "" : ` and (n.cik = $2 or exists (select 1 from public.news_companies nc where nc.news_id = n.id and nc.cik = $2))`;
  const { rows } = await db.query<{ category: string; n: string }>(
    `select category, count(*) as n from public.filings where accepted_at >= $1 and category is not null${only} group by category
     union all
     select 'press', count(*) from public.news n where n.published_at >= $1 and n.source <> 'sec' and n.cik is not null${newsOnly}`,
    params,
  );
  const out = { all: 0, press: 0, earnings: 0, news: 0, insider: 0, ipo: 0, proxy: 0 } as Record<Category | "all", number>;
  for (const r of rows) {
    if ((CATEGORIES as readonly string[]).includes(r.category)) out[r.category as Category] += Number(r.n);
    out.all += Number(r.n);
  }
  return out;
}

/**
 * The original text of an item, where we are allowed to keep it: a press release a company attached
 * to its filing (public domain), or a release from a source whose terms allow storing the text.
 * Null otherwise: the page then links to the original and shows no text of its own.
 */
export async function getOriginalText(db: Db, id: string): Promise<{ text: string; exhibitUrl: string | null } | null> {
  const [kind, ...rest] = id.split(":");
  const ref = rest.join(":");
  const { rows } =
    kind === "f"
      ? await db.query<{ body_text: string | null; url: string }>(
          `select body_text, url from public.news where accession = $1 and source = 'sec' and body_text is not null order by exhibit limit 1`, [ref])
      : await db.query<{ body_text: string | null; url: string }>(
          `select n.body_text, n.url from public.news n join public.news_sources s on s.key = n.source
            where n.id = $1 and s.can_store_body and n.body_text is not null`, [/^\d{1,18}$/.test(ref) ? ref : "0"]);
  const text = rows[0]?.body_text?.trim();
  return text ? { text, exhibitUrl: kind === "f" ? rows[0].url : null } : null;
}
