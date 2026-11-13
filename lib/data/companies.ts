/** Companies: looking one up, searching, its health check, and the marks the worker reads. */
import type { Client, Pool, PoolClient } from "pg";
import type { Fundamentals, HealthCheck, RuleSet, Verdict } from "../health";
import { normalizeTicker } from "../sec/companies";

type Db = Pool | PoolClient | Client;

export type Company = {
  cik: number;
  /** The main ticker, BRK.B style. Null for a company that is not listed (for example one filing to go public). */
  ticker: string | null;
  name: string;
  exchange: string | null;
  /** What the TradingView widgets are given, e.g. "NASDAQ:AAPL". Null = no chart. */
  tvSymbol: string | null;
  /** The SEC's industry line, e.g. "Pharmaceutical Preparations". */
  industry: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  isEmergingGrowth: boolean | null;
  /** False until the worker has read the SEC's record of the company: the page shows "gathering" until then. */
  profileReady: boolean;
  /** False until the worker has read the company's financial numbers. */
  factsReady: boolean;
};

const COLS = `c.cik::text as cik, c.ticker, c.name, c.exchange, c.tv_symbol, c.sic_description, c.city, c.state, c.website,
  c.is_emerging_growth, c.profile_checked_at is not null as profile_ready, c.facts_checked_at is not null as facts_ready`;

type Row = {
  cik: string; ticker: string | null; name: string; exchange: string | null; tv_symbol: string | null; sic_description: string | null;
  city: string | null; state: string | null; website: string | null; is_emerging_growth: boolean | null; profile_ready: boolean; facts_ready: boolean;
};

const toCompany = (r: Row): Company => ({
  cik: Number(r.cik), ticker: r.ticker, name: r.name, exchange: r.exchange, tvSymbol: r.tv_symbol, industry: r.sic_description,
  city: r.city, state: r.state, website: r.website, isEmergingGrowth: r.is_emerging_growth, profileReady: r.profile_ready, factsReady: r.facts_ready,
});

/** Any of a company's tickers finds it (GOOG and GOOGL are one company). Accepts "brk-b", "$aapl". */
export async function getCompanyByTicker(db: Db, raw: string): Promise<Company | null> {
  const ticker = normalizeTicker(raw);
  if (!ticker) return null;
  const { rows } = await db.query<Row>(
    `select ${COLS} from public.company_tickers t join public.companies c on c.cik = t.cik where t.ticker = $1`,
    [ticker],
  );
  return rows[0] ? toCompany(rows[0]) : null;
}

export async function getCompanyByCik(db: Db, cik: number): Promise<Company | null> {
  if (!Number.isSafeInteger(cik) || cik <= 0) return null;
  const { rows } = await db.query<Row>(`select ${COLS} from public.companies c where c.cik = $1`, [cik]);
  return rows[0] ? toCompany(rows[0]) : null;
}

export type CompanyMatch = Company & { verdict: Verdict | null };

/**
 * Search by ticker or name. An exact ticker comes first, then tickers that start with the text, then
 * names that start with it, then names that contain it. Only listed companies (those with a ticker).
 */
export async function searchCompanies(db: Db, text: string, limit = 8): Promise<CompanyMatch[]> {
  const q = text.trim().replace(/^\$/, "");
  if (!q || q.length > 60) return [];
  const escaped = q.replace(/[\\%_]/g, (m) => "\\" + m);
  const { rows } = await db.query<Row & { verdict: Verdict | null }>(
    `select ${COLS}, h.verdict
       from public.companies c
       left join lateral (select verdict from public.fundamentals_snapshots s where s.cik = c.cik order by as_of desc limit 1) h on true
      where c.ticker is not null
        and (c.ticker = upper($1) or c.ticker like upper($2) || '%' or c.name ilike $2 || '%' or c.name ilike '%' || $2 || '%'
             or exists (select 1 from public.company_tickers t where t.cik = c.cik and t.ticker = upper($1)))
      order by (c.ticker = upper($1)) desc,
               exists (select 1 from public.company_tickers t where t.cik = c.cik and t.ticker = upper($1)) desc,
               (c.ticker like upper($2) || '%') desc, (c.name ilike $2 || '%') desc, c.tracked desc, length(c.name), c.ticker
      limit $3`,
    [q, escaped, Math.min(Math.max(limit, 1), 50)],
  );
  return rows.map((r) => ({ ...toCompany(r), verdict: r.verdict }));
}

export type Snapshot = {
  /** The date the numbers were read. */
  asOf: string;
  verdict: Verdict | null;
  ruleSet: RuleSet;
  noScoreReason: string | null;
  health: HealthCheck;
  quarters: Fundamentals["quarters"];
  ttm: Fundamentals["ttm"] & { cash?: Fundamentals["cash"] };
  /** The newest filing the numbers came from. */
  sourceFiled: string | null;
};

/** The latest health check for a company, or null when the worker has not made one yet. */
export async function getSnapshot(db: Db, cik: number): Promise<Snapshot | null> {
  const { rows } = await db.query(
    `select as_of::text as as_of, verdict, rule_set, no_score_reason, score, quarters, ttm, source_filed::text as source_filed
       from public.fundamentals_snapshots where cik = $1 order by as_of desc limit 1`,
    [cik],
  );
  const r = rows[0];
  if (!r || !r.score) return null;
  return {
    asOf: r.as_of, verdict: r.verdict, ruleSet: r.rule_set, noScoreReason: r.no_score_reason, health: r.score,
    quarters: r.quarters ?? [], ttm: r.ttm ?? {}, sourceFiled: r.source_filed,
  };
}

/**
 * Someone opened this company's page. Puts it on the worker's list (its SEC record, recent filings and
 * health check are then gathered within seconds) and keeps it there while people keep looking.
 */
export async function markViewed(db: Db, cik: number): Promise<void> {
  await db.query(
    `update public.companies set tracked = true, viewed_at = now()
      where cik = $1 and (not tracked or viewed_at is null or viewed_at < now() - interval '1 hour')`,
    [cik],
  );
}

export type Trending = { ticker: string; name: string; posts: number };

/** Listed companies with the most news in the last day (no prices involved): the chips under the search box. */
export async function trendingCompanies(db: Db, limit = 6): Promise<Trending[]> {
  const { rows } = await db.query<{ ticker: string; name: string; posts: string }>(
    `select c.ticker, c.name, count(*) as posts
       from (select cik from public.filings where accepted_at > now() - interval '24 hours' and category in ('earnings', 'news', 'ipo')
             union all
             select cik from public.news where published_at > now() - interval '24 hours' and source <> 'sec' and cik is not null) x
       join public.companies c on c.cik = x.cik
      where c.ticker is not null
      group by c.cik, c.ticker, c.name
      order by count(*) desc, max(c.viewed_at) desc nulls last, c.ticker
      limit $1`,
    [Math.min(Math.max(limit, 1), 20)],
  );
  return rows.map((r) => ({ ticker: r.ticker, name: r.name, posts: Number(r.posts) }));
}

export type CheckedCompany = { ticker: string; name: string; verdict: Verdict; ruleSet: RuleSet };

/** Recently viewed companies that have a verdict: the examples on the health check page. */
export async function popularChecks(db: Db, limit = 6): Promise<CheckedCompany[]> {
  const { rows } = await db.query<{ ticker: string; name: string; verdict: Verdict; rule_set: RuleSet }>(
    `select c.ticker, c.name, h.verdict, h.rule_set
       from public.companies c
       join lateral (select verdict, rule_set from public.fundamentals_snapshots s where s.cik = c.cik order by as_of desc limit 1) h on true
      where c.ticker is not null and c.tracked and h.verdict is not null
      order by c.viewed_at desc nulls last, c.ticker
      limit $1`,
    [Math.min(Math.max(limit, 1), 24)],
  );
  return rows.map((r) => ({ ticker: r.ticker, name: r.name, verdict: r.verdict, ruleSet: r.rule_set }));
}
