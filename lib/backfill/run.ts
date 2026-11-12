/**
 * Copies the two old databases into the unified tables (plan Phase 1, step 3).
 *
 *   target = the one database (Supabase). The old app's tables already live there.
 *   site   = the data site's own Postgres (subscribers, follows, news, pick alerts, inquiries).
 *            Optional: without it, only the old app's tables are copied.
 *
 * Rules the whole file follows:
 *   - The old tables are only ever read. Nothing in them is changed or deleted.
 *   - Every step can run again. A row the new site has since changed is left alone; a row that is still
 *     exactly as the copy left it is refreshed from the old data.
 *   - Consent records (wording, time, IP, browser) are copied as text, character for character, with
 *     timestamps kept to the microsecond, and then read back and compared.
 *   - The caller owns the transactions, so a dry run can roll everything back.
 */
import type { Client } from "pg";
import {
  BASIC_SUMMARY_WHY,
  candidateKey,
  categoriesFromAppPrefs,
  DATA_SITE_FOLLOW_CATEGORIES,
  derivedToken,
  mergeCandidates,
  newsSourceKey,
  parseSecArchiveUrl,
  secIndexUrl,
  type Candidate,
} from "./mapping";
import { normalizeTicker } from "../sec/companies";

export const STEPS = ["users", "watchlists", "filings", "summaries", "news", "subscriptions", "picks", "broadcasts", "inquiries"] as const;
export type StepName = (typeof STEPS)[number];
/** Steps that write into tables the old app still reads. They run only at the switch-over. */
export const CUTOVER_ONLY: StepName[] = ["picks", "broadcasts"];

export type StepReport = {
  step: StepName;
  ran: boolean;
  /** Rows read from the old tables. */
  source: number;
  inserted: number;
  refreshed: number;
  /** Rows the new site has changed since they were copied: not touched. */
  leftAlone: number;
  skipped: Record<string, number>;
  notes: string[];
  targetBefore: number;
  targetAfter: number;
};
export type Check = { name: string; ok: boolean; detail: string };
export type BackfillReport = { steps: StepReport[]; checks: Check[]; ok: boolean };

export type BackfillOptions = {
  only?: StepName[];
  skip?: StepName[];
  /** Include the steps in CUTOVER_ONLY. */
  cutover?: boolean;
  /** Allow a run although a switch-over copy has already been recorded. */
  afterCutover?: boolean;
  batchSize?: number;
  log?: (line: string) => void;
};

type Ctx = { target: Client; site: Client | null; batch: number; log: (line: string) => void; checks: Check[] };

/** A timestamp as text in UTC with microseconds, so it survives the trip between databases unchanged. */
const ts = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+[1-9][0-9]{6,14}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

function blank(step: StepName): StepReport {
  return { step, ran: false, source: 0, inserted: 0, refreshed: 0, leftAlone: 0, skipped: {}, notes: [], targetBefore: 0, targetAfter: 0 };
}
const skip = (r: StepReport, reason: string, n = 1) => {
  r.skipped[reason] = (r.skipped[reason] ?? 0) + n;
};

async function count(c: Client, table: string, where = ""): Promise<number> {
  return Number((await c.query(`select count(*) from ${table} ${where}`)).rows[0].count);
}

/** 'r' for an ordinary table, 'v' for a view, null when it does not exist. */
async function kind(c: Client, table: string): Promise<string | null> {
  const { rows } = await c.query(
    `select c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`,
    [table],
  );
  return rows[0]?.relkind ?? null;
}
const isTable = async (c: Client, table: string) => (await kind(c, table)) === "r";

/** `key` is the table's numeric id, written with its table alias ("s.id"). */
type PageQuery = { cols: string; from: string; key: string; where?: string };

/**
 * Reads a whole old table a page at a time, in id order, and then checks that every row was read.
 *
 * The id comes back as text under the name `id`, so the paging must order by the real column. A bare
 * "order by id" would sort that text ("10" before "2") and silently skip rows on any table larger than
 * one page; that is why the key has to carry its table alias.
 */
async function readAll<T>(
  ctx: Ctx, c: Client, label: string, q: PageQuery, each: (page: (T & { id: string })[]) => Promise<void> | void,
): Promise<number> {
  if (!/^[a-z_]+\.[a-z_]+$/.test(q.key)) throw new Error(`Page key "${q.key}" must be written as alias.column`);
  const filter = q.where ? `and (${q.where})` : "";
  const total = Number((await c.query(`select count(*) from ${q.from} where true ${filter}`)).rows[0].count);
  let after = "0";
  let read = 0;
  for (;;) {
    const { rows } = await c.query(
      `select ${q.key}::text as id, ${q.cols} from ${q.from} where ${q.key} > $1::bigint ${filter} order by ${q.key} limit $2`,
      [after, ctx.batch],
    );
    if (!rows.length) break;
    read += rows.length;
    await each(rows as (T & { id: string })[]);
    after = rows[rows.length - 1].id;
  }
  ctx.checks.push({ name: `${label}: every old row was read`, ok: read === total, detail: `${read} of ${total}` });
  return read;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Company = { cik: number; name: string };
async function tickerMap(target: Client): Promise<Map<string, Company>> {
  const { rows } = await target.query<{ ticker: string; cik: string; name: string }>(
    `select t.ticker, t.cik, c.name from public.company_tickers t join public.companies c on c.cik = t.cik`,
  );
  return new Map(rows.map((r) => [r.ticker, { cik: Number(r.cik), name: r.name }]));
}

/* ------------------------------------------------------------------ users */

async function stepUsers({ target }: Ctx): Promise<StepReport> {
  const r = blank("users");
  if (!(await isTable(target, "profiles"))) {
    r.notes.push("profiles is no longer a table (already switched over): nothing to copy.");
    return r;
  }
  r.ran = true;
  r.source = await count(target, "public.profiles");
  r.targetBefore = await count(target, "public.users");
  // Free any chat name that is about to move, so two people swapping names cannot trip the unique rule.
  await target.query(
    `update public.users u set display_name = null
       from public.profiles p
      where p.id = u.id and u.display_name is not null and u.display_name is distinct from p.display_name`,
  );
  const { rows } = await target.query<{ inserted: boolean }>(
    `insert into public.users as u (id, email, display_name, chat_banned, created_at)
     select id, email, display_name, chat_banned, created_at from public.profiles
     on conflict (id) do update
       set email = excluded.email, display_name = excluded.display_name, chat_banned = excluded.chat_banned
     where (u.email, u.display_name, u.chat_banned) is distinct from (excluded.email, excluded.display_name, excluded.chat_banned)
     returning (xmax = 0) as inserted`,
  );
  r.inserted = rows.filter((x) => x.inserted).length;
  r.refreshed = rows.length - r.inserted;
  skip(r, "already copied, unchanged", r.source - rows.length);
  r.targetAfter = await count(target, "public.users");
  return r;
}

/* ------------------------------------------------------------- watchlists */

async function stepWatchlists({ target }: Ctx): Promise<StepReport> {
  const r = blank("watchlists");
  if (!(await isTable(target, "watchlist"))) {
    r.notes.push("The old watchlist table is not here: nothing to copy.");
    return r;
  }
  r.ran = true;
  r.source = await count(target, "public.watchlist");
  r.targetBefore = await count(target, "public.watchlists");
  const match = `replace(upper(btrim(w.ticker)), '-', '.')`;
  const { rows } = await target.query<{ inserted: boolean }>(
    `insert into public.watchlists as n (user_id, cik, added_at, backfilled_at)
     select w.user_id, t.cik, min(w.added_at), now()
       from public.watchlist w
       join public.users u on u.id = w.user_id
       join public.company_tickers t on t.ticker = ${match}
      group by w.user_id, t.cik
     on conflict (user_id, cik) do update set backfilled_at = now() where n.backfilled_at is not null
     returning (xmax = 0) as inserted`,
  );
  r.inserted = rows.filter((x) => x.inserted).length;
  r.refreshed = rows.length - r.inserted;
  const unknown = await target.query<{ ticker: string; n: string }>(
    `select w.ticker, count(*) as n from public.watchlist w
      where not exists (select 1 from public.company_tickers t where t.ticker = ${match})
      group by w.ticker order by count(*) desc`,
  );
  const lost = unknown.rows.reduce((s, x) => s + Number(x.n), 0);
  if (lost) {
    skip(r, "ticker not in the company list", lost);
    r.notes.push(`Tickers not in the company list: ${unknown.rows.slice(0, 40).map((x) => `${x.ticker} (${x.n})`).join(", ")}`);
  }
  const pairs = Number(
    (await target.query(
      `select count(*) from (
         select distinct w.user_id, t.cik from public.watchlist w
           join public.users u on u.id = w.user_id
           join public.company_tickers t on t.ticker = ${match}) x`,
    )).rows[0].count,
  );
  const noAccount = await count(target, "public.watchlist w", "where not exists (select 1 from public.users u where u.id = w.user_id)");
  if (noAccount) skip(r, "no account for this watchlist row", noAccount);
  r.leftAlone = pairs - rows.length; // already on the new list and since changed there
  const merged = r.source - lost - noAccount - pairs;
  if (merged > 0) skip(r, "same company under two tickers (kept once)", merged);
  // Rows this script copied on an earlier run that have since been removed from the old watchlist.
  const gone = await target.query(
    `delete from public.watchlists where backfilled_at is not null and backfilled_at < now()`,
  );
  if (gone.rowCount) r.notes.push(`Removed ${gone.rowCount} copied rows that are no longer in the old watchlist.`);
  r.targetAfter = await count(target, "public.watchlists");
  return r;
}

/* ---------------------------------------------------------------- filings */

type FilingRow = { accession: string; cik: number; form: string; accepted: string; primary_url: string; index_url: string; name: string };

async function saveFilings(target: Client, rows: FilingRow[]): Promise<{ filings: number; companies: number }> {
  if (!rows.length) return { filings: 0, companies: 0 };
  const json = JSON.stringify(rows);
  // A filing from a company we do not have yet still needs a company row to hang on.
  const co = await target.query(
    `insert into public.companies (cik, name)
     select distinct on (x.cik) x.cik, coalesce(nullif(btrim(x.name), ''), 'Company ' || x.cik)
       from jsonb_to_recordset($1::jsonb) as x(cik bigint, name text)
      order by x.cik
     on conflict (cik) do nothing`,
    [json],
  );
  const f = await target.query(
    `insert into public.filings (accession, cik, form, accepted_at, filed_date, primary_url, index_url)
     select x.accession, x.cik, x.form, x.accepted::timestamptz,
            (x.accepted::timestamptz at time zone 'America/New_York')::date, x.primary_url, x.index_url
       from jsonb_to_recordset($1::jsonb)
         as x(accession text, cik bigint, form text, accepted text, primary_url text, index_url text)
     on conflict (accession) do nothing`,
    [json],
  );
  return { filings: f.rowCount ?? 0, companies: co.rowCount ?? 0 };
}

async function stepFilings(ctx: Ctx): Promise<StepReport> {
  const { target, site, batch } = ctx;
  const r = blank("filings");
  r.targetBefore = await count(target, "public.filings");
  let newCompanies = 0;

  // 1. Filings the old app wrote summaries for.
  if (await isTable(target, "filing_summaries")) {
    r.ran = true;
    const { rows } = await target.query<{ accession: string; company_name: string; form: string; accepted: string; url: string }>(
      `select accession, company_name, form, ${ts("accepted")} as accepted, url from public.filing_summaries order by accession`,
    );
    r.source += rows.length;
    const good: FilingRow[] = [];
    for (const s of rows) {
      const link = parseSecArchiveUrl(s.url);
      if (!link) skip(r, "summary whose link is not in the SEC archive");
      else if (link.accession !== s.accession) skip(r, "summary whose link is for a different filing");
      else {
        good.push({
          accession: s.accession, cik: link.cik, form: s.form, accepted: s.accepted,
          primary_url: s.url, index_url: secIndexUrl(link.cik, s.accession), name: s.company_name,
        });
      }
    }
    for (const part of chunks(good, batch)) {
      const saved = await saveFilings(target, part);
      r.inserted += saved.filings;
      newCompanies += saved.companies;
      skip(r, "already in filings", part.length - saved.filings);
    }
  }

  // 2. Filings the data site collected for its feed.
  if (site && (await isTable(site, "news_items"))) {
    r.ran = true;
    type Row = { company: string | null; url: string; form_type: string | null; published: string };
    const q: PageQuery = {
      cols: `n.company, n.url, n.form_type, ${ts("n.published_at")} as published`, from: "news_items n", key: "n.id", where: "n.kind = 'filing'",
    };
    r.source += await readAll<Row>(ctx, site, "filings from the data site's feed", q, async (page) => {
      const good = new Map<string, FilingRow>();
      for (const n of page) {
        const link = parseSecArchiveUrl(n.url);
        if (!link) skip(r, "feed item whose link is not in the SEC archive");
        else if (!n.form_type?.trim()) skip(r, "feed item with no form type");
        else if (good.has(link.accession)) skip(r, "same filing listed twice");
        else {
          const index = secIndexUrl(link.cik, link.accession);
          // The data site kept the filing's index page; the worker fills in the main document later.
          good.set(link.accession, {
            accession: link.accession, cik: link.cik, form: n.form_type.trim(), accepted: n.published,
            primary_url: index, index_url: index, name: n.company ?? "",
          });
        }
      }
      const part = [...good.values()];
      const saved = await saveFilings(target, part);
      r.inserted += saved.filings;
      newCompanies += saved.companies;
      skip(r, "already in filings", part.length - saved.filings);
    });
  }
  if (newCompanies) r.notes.push(`Added ${newCompanies} companies that were not in the company list (no ticker).`);
  r.targetAfter = await count(target, "public.filings");
  return r;
}

/* -------------------------------------------------------------- summaries */

async function stepSummaries({ target }: Ctx): Promise<StepReport> {
  const r = blank("summaries");
  if (!(await isTable(target, "filing_summaries"))) {
    r.notes.push("The old filing_summaries table is not here: nothing to copy.");
    return r;
  }
  r.ran = true;
  r.source = await count(target, "public.filing_summaries");
  r.targetBefore = await count(target, "public.summaries");
  // Insider trades were built from the filing itself, and the plain fallback was used when Claude could
  // not be reached: neither was written by AI, so neither is labelled as AI.
  const ins = await target.query(
    `insert into public.summaries
       (accession, kind, model, prompt_version, headline, bullets, why_it_matters, tone, importance, category, source_url, created_at)
     select s.accession,
            case when s.form = '4' or s.why_it_matters = $1 then 'rule' else 'ai' end,
            case when s.form = '4' or s.why_it_matters = $1 then null else 'claude-opus-5-5' end,
            1, s.headline, s.bullets, s.why_it_matters, s.tone, s.importance, s.category, s.url, s.created_at
       from public.filing_summaries s
       join public.filings f on f.accession = s.accession
     on conflict (accession) do nothing`,
    [BASIC_SUMMARY_WHY],
  );
  r.inserted = ins.rowCount ?? 0;
  const noFiling = await count(
    target,
    "public.filing_summaries s",
    "where not exists (select 1 from public.filings f where f.accession = s.accession)",
  );
  if (noFiling) skip(r, "no filing row (its link was not usable; see the filings step)", noFiling);
  skip(r, "already in summaries", r.source - noFiling - r.inserted);
  r.targetAfter = await count(target, "public.summaries");
  return r;
}

/* ------------------------------------------------------------------- news */

async function stepNews(ctx: Ctx): Promise<StepReport> {
  const { target, site } = ctx;
  const r = blank("news");
  if (!site || !(await isTable(site, "news_items"))) {
    r.notes.push("No data-site database given: press releases were not copied.");
    return r;
  }
  r.ran = true;
  r.targetBefore = await count(target, "public.news");
  const tickers = await tickerMap(target);
  const known = new Set((await target.query<{ key: string }>(`select key from public.news_sources`)).rows.map((x) => x.key));
  const unknownSources = new Map<string, number>();
  type Row = { ticker: string | null; company: string | null; title: string; url: string; source: string; published: string };
  const q: PageQuery = {
    cols: `n.ticker, n.company, n.title, n.url, n.source, ${ts("n.published_at")} as published`, from: "news_items n", key: "n.id",
    where: "n.kind = 'press'",
  };
  r.source = await readAll<Row>(ctx, site, "press releases", q, async (page) => {
    const good: Record<string, unknown>[] = [];
    for (const n of page) {
      const key = newsSourceKey(n.source);
      if (!key || !known.has(key)) {
        unknownSources.set(n.source, (unknownSources.get(n.source) ?? 0) + 1);
        skip(r, "source we do not recognise");
        continue;
      }
      if (!/^https:\/\//.test(n.url)) {
        skip(r, "link is not https");
        continue;
      }
      if (!n.title?.trim()) {
        skip(r, "no headline");
        continue;
      }
      const ticker = normalizeTicker(n.ticker);
      good.push({
        source: key, cik: ticker ? tickers.get(ticker)?.cik ?? null : null, ticker: ticker ?? n.ticker,
        company_name: n.company, title: n.title, url: n.url, published: n.published,
      });
    }
    if (!good.length) return;
    const ins = await target.query(
      `insert into public.news (source, cik, ticker, company_name, title, url, published_at)
       select x.source, x.cik, x.ticker, x.company_name, x.title, x.url, x.published::timestamptz
         from jsonb_to_recordset($1::jsonb)
           as x(source text, cik bigint, ticker text, company_name text, title text, url text, published text)
       on conflict (url) do nothing`,
      [JSON.stringify(good)],
    );
    r.inserted += ins.rowCount ?? 0;
    skip(r, "already in news", good.length - (ins.rowCount ?? 0));
  });
  if (unknownSources.size) {
    r.notes.push(`Sources not copied: ${[...unknownSources].map(([s, n]) => `${s} (${n})`).join(", ")}`);
  }
  r.targetAfter = await count(target, "public.news");
  return r;
}

/* ---------------------------------------------------------- subscriptions */

const SUB_COLS = `channel text, address text, cik bigint, categories text[], cadence text, status text,
  "confirmToken" text, "unsubscribeToken" text, "legacyToken" text, "consentText" text, "consentAt" text,
  "consentIp" text, "consentUserAgent" text, source text, "confirmedAt" text, "unsubscribedAt" text,
  "createdAt" text, legacy jsonb`;

async function stepSubscriptions(ctx: Ctx): Promise<StepReport> {
  const { target, site, batch, checks } = ctx;
  const r = blank("subscriptions");
  r.targetBefore = await count(target, "public.alert_subscriptions");
  const tickers = await tickerMap(target);
  const all = new Map<string, Candidate>();
  const sources: string[] = [];
  const unknownTickers = new Map<string, number>();
  const add = (c: Candidate) => {
    const key = candidateKey(c);
    const had = all.get(key);
    if (had) skip(r, "same subscription on both old sites (merged into one)");
    all.set(key, had ? mergeCandidates(had, c) : c);
  };
  const noTicker = (t: string) => {
    unknownTickers.set(t, (unknownTickers.get(t) ?? 0) + 1);
    skip(r, "ticker not in the company list");
  };

  /* The old app: one row per person, with a list of tickers. */
  if (await isTable(target, "alert_subscribers")) {
    r.ran = true;
    sources.push("app:alert_subscribers");
    type A = { id: string; email: string; token: string; confirmed: boolean; tickers: string[]; prefs: Record<string, unknown> | null; created: string };
    const { rows } = await target.query<A>(
      `select id::text as id, email, token, confirmed, tickers, prefs, ${ts("created_at")} as created
         from public.alert_subscribers order by created_at, id`,
    );
    r.source += rows.length;
    for (const a of rows) {
      const email = a.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        skip(r, "address is not a valid email");
        continue;
      }
      const base = {
        channel: "email" as const, address: email, cadence: a.prefs?.mode === "daily" ? ("digest" as const) : ("instant" as const),
        status: a.confirmed ? ("active" as const) : ("pending" as const), legacyToken: TOKEN_RE.test(a.token) ? a.token : null,
        consentText: null, consentAt: null, consentIp: null, consentUserAgent: null, source: "app",
        confirmedAt: null, unsubscribedAt: null, createdAt: a.created,
      };
      const row = (cik: number | null, categories: Candidate["categories"]): Candidate => ({
        ...base, cik, categories,
        confirmToken: a.confirmed ? null : derivedToken("app-confirm", a.token, cik ?? "general"),
        unsubscribeToken: derivedToken("app-unsubscribe", a.token, cik ?? "general"),
        legacy: { source: "app:alert_subscribers", id: a.id },
      });
      let made = 0;
      for (const raw of a.tickers ?? []) {
        const t = normalizeTicker(raw);
        const co = t ? tickers.get(t) : undefined;
        if (!co) {
          noTicker(String(raw));
          continue;
        }
        add(row(co.cik, categoriesFromAppPrefs(a.prefs as { earnings?: boolean; news?: boolean; insider?: boolean })));
        made++;
      }
      if (a.prefs?.picks === true) {
        add(row(null, ["picks"]));
        made++;
      }
      if (!made) skip(r, "person with nothing to follow");
    }
  }

  /* The data site: people (the general list), then the companies they follow. */
  if (site && (await isTable(site, "subscribers"))) {
    r.ran = true;
    sources.push("data-site:subscribers");
    type S = {
      email: string | null; phone: string | null; sms_consent: boolean; consent_text: string | null; consent_at: string | null;
      ip: string | null; user_agent: string | null; source: string | null; created: string; unsubscribed: string | null;
      general_alerts: boolean; premium: boolean; unsub_token: string | null;
    };
    const cols = new Set(
      (await site.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'subscribers'`,
      )).rows.map((x) => x.column_name),
    );
    const opt = (col: string, fallback: string) => (cols.has(col) ? `s.${col}` : `${fallback} as ${col}`);
    const q: PageQuery = {
      cols: `s.email, s.phone, s.sms_consent, s.consent_text, ${ts("s.consent_at")} as consent_at, s.ip, s.user_agent, s.source,
             ${ts("s.created_at")} as created, ${ts("s.unsubscribed_at")} as unsubscribed,
             ${opt("general_alerts", "true")}, ${opt("premium", "false")}, ${opt("unsub_token", "null::text")}`,
      from: "subscribers s", key: "s.id",
    };
    r.source += await readAll<S>(ctx, site, "data-site subscribers", q, (page) => {
      for (const s of page) {
        const legacy = {
          source: "data-site:subscribers", id: s.id, general_alerts: s.general_alerts, sms_consent: s.sms_consent, premium: s.premium,
        };
        const evidence = {
          cadence: "instant" as const, cik: null, categories: ["picks"] as Candidate["categories"], confirmToken: null,
          consentText: s.consent_text, consentAt: s.consent_at, consentIp: s.ip, consentUserAgent: s.user_agent,
          source: s.source, confirmedAt: null, createdAt: s.created, legacy,
        };
        // Off the general list by the unsubscribe link (no time was recorded), or never on it (follow only).
        const offList = !s.general_alerts;
        const followOnly = offList && s.source === "follow" && !s.unsubscribed;

        if (s.email !== null) {
          const email = s.email.trim().toLowerCase();
          if (!EMAIL_RE.test(email)) skip(r, "address is not a valid email");
          else if (followOnly) skip(r, "follows companies only: was never on the general list");
          else {
            const token = s.unsub_token && TOKEN_RE.test(s.unsub_token) ? s.unsub_token : null;
            add({
              ...evidence, channel: "email", address: email,
              status: s.unsubscribed || offList ? "unsubscribed" : "active",
              unsubscribedAt: s.unsubscribed,
              unsubscribeToken: token ?? derivedToken("site-email", s.id), legacyToken: token,
            });
          }
        }
        if (s.phone !== null) {
          if (!PHONE_RE.test(s.phone)) skip(r, "phone is not in +15555550123 form");
          else if (!s.sms_consent) skip(r, "phone with no consent to texts");
          else if (followOnly) skip(r, "follows companies only: was never on the general list");
          else {
            add({
              ...evidence, channel: "sms", address: s.phone,
              status: s.unsubscribed || offList ? "unsubscribed" : "active",
              unsubscribedAt: s.unsubscribed,
              unsubscribeToken: derivedToken("site-sms", s.id), legacyToken: null,
            });
          }
        }
      }
    });

    if (await isTable(site, "ticker_follows")) {
      sources.push("data-site:ticker_follows");
      type F = {
        subscriber_id: string; ticker: string; channel: "email" | "sms"; token: string; consent_text: string | null;
        consent_at: string | null; confirmed: string | null; unsubscribed: string | null; created: string;
        email: string | null; phone: string | null; s_unsubscribed: string | null; sms_consent: boolean;
      };
      const fq: PageQuery = {
        cols: `f.subscriber_id::text as subscriber_id, f.ticker, f.channel, f.token, f.consent_text,
               ${ts("f.consent_at")} as consent_at, ${ts("f.confirmed_at")} as confirmed, ${ts("f.unsubscribed_at")} as unsubscribed,
               ${ts("f.created_at")} as created, s.email, s.phone, ${ts("s.unsubscribed_at")} as s_unsubscribed, s.sms_consent`,
        from: "ticker_follows f join subscribers s on s.id = f.subscriber_id", key: "f.id",
      };
      r.source += await readAll<F>(ctx, site, "data-site follows", fq, (page) => {
        for (const f of page) {
          const address = f.channel === "email" ? f.email?.trim().toLowerCase() ?? null : f.phone;
          if (!address || !(f.channel === "email" ? EMAIL_RE : PHONE_RE).test(address)) {
            skip(r, "follow with no usable address");
            continue;
          }
          if (!TOKEN_RE.test(f.token)) {
            skip(r, "follow with an unusable link token");
            continue;
          }
          const t = normalizeTicker(f.ticker);
          const co = t ? tickers.get(t) : undefined;
          if (!co) {
            noTicker(f.ticker);
            continue;
          }
          // A STOP reply ends every text subscription for that number, as on the old site.
          const stopped = f.channel === "sms" ? f.s_unsubscribed : null;
          const noConsent = f.channel === "sms" && !f.sms_consent;
          const status: Candidate["status"] =
            f.unsubscribed || stopped || noConsent ? "unsubscribed" : f.confirmed ? "active" : "pending";
          add({
            channel: f.channel, address, cik: co.cik, categories: DATA_SITE_FOLLOW_CATEGORIES, cadence: "instant", status,
            confirmToken: status === "pending" ? f.token : null, unsubscribeToken: f.token, legacyToken: f.token,
            consentText: f.consent_text, consentAt: f.consent_at, consentIp: null, consentUserAgent: null, source: "follow",
            confirmedAt: f.confirmed, unsubscribedAt: f.unsubscribed ?? stopped, createdAt: f.created,
            legacy: { source: "data-site:ticker_follows", id: f.id, subscriber_id: f.subscriber_id },
          });
        }
      });
    }
  } else if (!site) {
    r.notes.push("No data-site database given: only the old app's subscribers were copied.");
  }

  /* Save.
   *
   * A row that is already there is refreshed from the old data only when both of these hold:
   *   - the new site has not changed it since it was copied (updated_at = backfilled_at), and
   *   - every old table it was built from was read in this run. Without this, a run that leaves out the
   *     data site would rebuild a merged row from the old app alone, losing an opt-out recorded on the
   *     data site and wiping the consent record.
   */
  const ours = `s.backfilled_at is not null and s.updated_at = s.backfilled_at`;
  const complete = (param: string) =>
    `s.legacy->>'source' = any(${param}::text[])
     and coalesce(s.legacy->'merged_with'->>'source', s.legacy->>'source') = any(${param}::text[])`;
  const at = (s: string | null) => (s ? Date.parse(s) : NaN);
  /** True when the person signed up or confirmed again after the old opt-out (the same rule as the SQL below). */
  const optedInAgain = (row: { confirmed: string | null; created: string; copied: string | null }, c: Candidate) => {
    if (c.unsubscribedAt) return Math.max(at(row.confirmed) || -Infinity, at(row.created)) > at(c.unsubscribedAt);
    return row.confirmed !== null && at(row.confirmed) > (row.copied ? at(row.copied) : -Infinity);
  };
  let mismatched = 0;
  let compared = 0;
  let optOutsApplied = 0;
  let stillReceiving = 0;
  for (const part of chunks([...all.values()], batch)) {
    const { rows } = await target.query<{ inserted: boolean }>(
      `insert into public.alert_subscriptions as s
         (channel, address, cik, categories, cadence, status, confirm_token, unsubscribe_token, legacy_token,
          consent_text, consent_at, consent_ip, consent_user_agent, source, confirmed_at, unsubscribed_at,
          created_at, updated_at, backfilled_at, legacy)
       select x.channel, x.address, x.cik, x.categories, x.cadence, x.status, x."confirmToken", x."unsubscribeToken", x."legacyToken",
              x."consentText", x."consentAt"::timestamptz, x."consentIp", x."consentUserAgent", x.source,
              x."confirmedAt"::timestamptz, x."unsubscribedAt"::timestamptz, x."createdAt"::timestamptz, now(), now(), x.legacy
         from jsonb_to_recordset($1::jsonb) as x(${SUB_COLS})
       on conflict on constraint alert_subscriptions_one_per_address_and_company do update
         set categories = excluded.categories, cadence = excluded.cadence, status = excluded.status,
             confirm_token = excluded.confirm_token, unsubscribe_token = excluded.unsubscribe_token,
             legacy_token = excluded.legacy_token, consent_text = excluded.consent_text, consent_at = excluded.consent_at,
             consent_ip = excluded.consent_ip, consent_user_agent = excluded.consent_user_agent, source = excluded.source,
             confirmed_at = excluded.confirmed_at, unsubscribed_at = excluded.unsubscribed_at,
             created_at = excluded.created_at, backfilled_at = now(), legacy = excluded.legacy
       where ${ours} and ${complete("$2")}
       returning (xmax = 0) as inserted`,
      [JSON.stringify(part), sources],
    );
    const inserted = rows.filter((x) => x.inserted).length;
    r.inserted += inserted;
    r.refreshed += rows.length - inserted;

    // An opt-out on an old site always carries over, even to a row the new site has changed, unless the
    // person signed up or confirmed again after it. Where the old site recorded no time for the opt-out,
    // only a confirmation made here after the row was copied counts as "again".
    const off = await target.query(
      `update public.alert_subscriptions s
          set status = 'unsubscribed', unsubscribed_at = coalesce(x."unsubscribedAt"::timestamptz, now()),
              legacy = coalesce(s.legacy, '{}'::jsonb)
                       || jsonb_build_object('old_site_opt_out_applied_at', now(), 'old_site_opt_out', x.legacy)
         from jsonb_to_recordset($1::jsonb) as x(${SUB_COLS})
        where s.channel = x.channel and s.address = x.address and s.cik is not distinct from x.cik
          and x.status = 'unsubscribed' and s.status = 'active'
          and not (case when x."unsubscribedAt" is not null
                        then greatest(s.confirmed_at, s.created_at) > x."unsubscribedAt"::timestamptz
                        else s.confirmed_at is not null and s.confirmed_at > coalesce(s.backfilled_at, '-infinity'::timestamptz)
                   end)`,
      [JSON.stringify(part)],
    );
    optOutsApplied += off.rowCount ?? 0;

    // Read every row back: compare the consent evidence character for character, and check for
    // ourselves (not with the SQL above) that nobody the old data has opted out is still receiving.
    const back = await target.query<{
      channel: string; address: string; cik: string | null; status: string; consent_text: string | null; consent_at: string | null;
      consent_ip: string | null; consent_user_agent: string | null; written: boolean; ours: boolean;
      confirmed: string | null; created: string; copied: string | null;
    }>(
      `select s.channel, s.address, s.cik::text as cik, s.status, s.consent_text, ${ts("s.consent_at")} as consent_at, s.consent_ip,
              s.consent_user_agent, (s.backfilled_at = now()) is true as written, (${ours}) is true as ours,
              ${ts("s.confirmed_at")} as confirmed, ${ts("s.created_at")} as created, ${ts("s.backfilled_at")} as copied
         from public.alert_subscriptions s
         join jsonb_to_recordset($1::jsonb) as k(channel text, address text, cik bigint)
           on s.channel = k.channel and s.address = k.address and s.cik is not distinct from k.cik`,
      [JSON.stringify(part.map((c) => ({ channel: c.channel, address: c.address, cik: c.cik })))],
    );
    const saved = new Map(back.rows.map((x) => [`${x.channel}|${x.address}|${x.cik ?? ""}`, x]));
    for (const c of part) {
      const got = saved.get(candidateKey(c));
      if (!got) {
        mismatched++;
        continue;
      }
      if (got.written) {
        compared++;
        if (
          got.consent_text !== c.consentText || got.consent_at !== c.consentAt ||
          got.consent_ip !== c.consentIp || got.consent_user_agent !== c.consentUserAgent
        ) mismatched++;
      } else if (got.ours) {
        skip(r, "built partly from an old database that was not read in this run (left as it is)");
      } else {
        r.leftAlone++; // changed on the new site: deliberately not overwritten
      }
      if (c.status === "unsubscribed" && got.status === "active" && !optedInAgain(got, c)) stillReceiving++;
    }
  }
  checks.push({
    name: "Consent records copied exactly",
    ok: mismatched === 0,
    detail: mismatched === 0 ? `${compared} compared, all identical` : `${mismatched} of ${compared} differ`,
  });
  if (optOutsApplied) {
    r.notes.push(`Switched off ${optOutsApplied} subscriptions that were changed on the new site: the old data has a later opt-out for them.`);
  }

  // Copied on an earlier run, still untouched, and no longer in the old data (for example the person
  // unsubscribed on the old app, which deletes its record): stop sending to them. Only rows whose old
  // tables were all read in this run can be judged this way.
  if (sources.length) {
    const gone = await target.query(
      `update public.alert_subscriptions s
          set status = 'unsubscribed', unsubscribed_at = now(), backfilled_at = now(),
              legacy = coalesce(s.legacy, '{}'::jsonb) || jsonb_build_object('removed_from_old_site_noticed_at', now())
        where ${ours} and s.backfilled_at < now() and s.status <> 'unsubscribed' and ${complete("$1")}`,
      [sources],
    );
    if (gone.rowCount) r.notes.push(`Marked ${gone.rowCount} copied subscriptions as unsubscribed: they are no longer in the old data.`);
  }
  if (unknownTickers.size) {
    const top = [...unknownTickers].sort((a, b) => b[1] - a[1]).slice(0, 40);
    r.notes.push(`Follows not copied because the ticker is not in the company list: ${top.map(([t, n]) => `${t} (${n})`).join(", ")}`);
  }
  r.targetAfter = await count(target, "public.alert_subscriptions");

  // Nobody the old sites had opted out may end up active.
  const wrong = await count(
    target,
    "public.alert_subscriptions s",
    `where s.status = 'active' and ${ours} and (s.unsubscribed_at is not null or s.legacy ? 'removed_from_old_site_noticed_at')`,
  );
  const bad = wrong + stillReceiving;
  checks.push({ name: "No opted-out address is active", ok: bad === 0, detail: bad === 0 ? "none" : `${bad} rows` });
  return r;
}

/* ------------------------------------------------------------------ picks */

async function stepPicks(ctx: Ctx): Promise<StepReport> {
  const { target, site } = ctx;
  const r = blank("picks");
  if (!site || !(await isTable(site, "alerts"))) {
    r.notes.push("No data-site database given: pick alerts were not copied.");
    return r;
  }
  r.ran = true;
  r.targetBefore = await count(target, "public.picks");
  const tickers = await tickerMap(target);
  type A = {
    ticker: string; alerted: string; alert_price: string | null; sponsored: boolean; sponsor_comp: string | null;
    notes: string | null; tier: string | null; message: string | null; row: Record<string, unknown>;
  };
  const q: PageQuery = {
    cols: `a.ticker, ${ts("a.alerted_at")} as alerted, a.alert_price::text as alert_price, a.sponsored,
           a.sponsor_comp, a.notes, to_jsonb(a)->>'tier' as tier, to_jsonb(a)->>'message' as message, to_jsonb(a) as row`,
    from: "alerts a", key: "a.id",
  };
  let noDisclosure = 0;
  r.source = await readAll<A>(ctx, site, "pick alerts", q, async (page) => {
    const out = page.map((a) => {
      const t = normalizeTicker(a.ticker) ?? a.ticker;
      const co = tickers.get(t);
      const comp = a.sponsor_comp?.trim() ? a.sponsor_comp : null;
      if (a.sponsored && !comp) noDisclosure++;
      return {
        ticker: t, company_name: co?.name ?? t, cik: co?.cik ?? null,
        kind: a.sponsored ? "sponsored" : "pick",
        title: `${a.tier === "premium" ? "BigStocks Premium Pick" : "BigStocks Alert"}: $${t}`,
        why: a.message ?? "", posted: a.alerted, price: a.alert_price,
        // Kept word for word. Where the old site recorded nothing, say so rather than leave it looking unsponsored.
        disclosure: a.sponsored ? comp ?? "Sponsored. The old site did not record the compensation details." : null,
        legacy_id: a.id, legacy: a.row,
      };
    });
    const { rows } = await target.query<{ inserted: boolean }>(
      `insert into public.picks as p
         (ticker, company_name, cik, kind, title, why, author, tier, posted_at, price_at_post, owns_shares, ownership_note,
          disclosure_text, imported_from, legacy_id, legacy)
       select x.ticker, x.company_name, x.cik, x.kind, x.title, x.why, 'BigStocks', 'free', x.posted::timestamptz, x.price::numeric,
              null, '', x.disclosure, 'data-site:alerts', x.legacy_id, x.legacy
         from jsonb_to_recordset($1::jsonb)
           as x(ticker text, company_name text, cik bigint, kind text, title text, why text, posted text, price text,
                disclosure text, legacy_id text, legacy jsonb)
       on conflict (imported_from, legacy_id) where imported_from is not null do update set legacy = excluded.legacy
       where p.legacy is distinct from excluded.legacy
       returning (xmax = 0) as inserted`,
      [JSON.stringify(out)],
    );
    const inserted = rows.filter((x) => x.inserted).length;
    r.inserted += inserted;
    r.refreshed += rows.length - inserted;
    skip(r, "already copied, unchanged", out.length - rows.length);
  });
  if (noDisclosure) {
    r.notes.push(`${noDisclosure} sponsored alerts had no compensation text on the old site. They are marked as sponsored with a note saying so.`);
  }
  r.targetAfter = await count(target, "public.picks");
  return r;
}

/* ------------------------------------------------------------- broadcasts */

async function stepBroadcasts(ctx: Ctx): Promise<StepReport> {
  const { target, site } = ctx;
  const r = blank("broadcasts");
  if (!site || !(await isTable(site, "broadcasts"))) {
    r.notes.push("No data-site database given (or it has no broadcasts table): sends were not copied.");
    return r;
  }
  r.ran = true;
  r.targetBefore = await count(target, "public.broadcasts");
  const picks = new Map(
    (await target.query<{ id: string; legacy_id: string }>(
      `select id::text as id, legacy_id from public.picks where imported_from = 'data-site:alerts'`,
    )).rows.map((p) => [p.legacy_id, p.id]),
  );
  type B = {
    alert_id: string | null; channels: string[]; subject: string; text_body: string; html_body: string; sms_body: string;
    status: string; email_cursor: string; sms_cursor: string; emails_sent: number; texts_sent: number; failed: number; error: string | null;
    created: string; finished: string | null; row: Record<string, unknown>;
  };
  const q: PageQuery = {
    cols: `b.alert_id::text as alert_id, b.channels, b.subject, b.text_body, b.html_body, b.sms_body, b.status,
           b.email_cursor::text as email_cursor, b.sms_cursor::text as sms_cursor, b.emails_sent, b.texts_sent, b.failed, b.error,
           ${ts("b.created_at")} as created, ${ts("b.finished_at")} as finished,
           to_jsonb(b) - 'html_body' - 'text_body' - 'sms_body' as row`,
    from: "broadcasts b", key: "b.id",
  };
  let unfinished = 0;
  r.source = await readAll<B>(ctx, site, "sends", q, async (page) => {
    const out = page.map((b) => {
      const open = b.status === "queued" || b.status === "sending";
      if (open) unfinished++;
      return {
        pick_id: b.alert_id ? picks.get(b.alert_id) ?? null : null, channels: b.channels, subject: b.subject,
        text_body: b.text_body, html_body: b.html_body, sms_body: b.sms_body,
        // The new sender must never resume an old send: its position refers to the old list.
        status: open ? "failed" : b.status,
        error: open ? "Not finished on the old site when the data was moved." : b.error,
        email_cursor: b.email_cursor, sms_cursor: b.sms_cursor, emails_sent: b.emails_sent, texts_sent: b.texts_sent, failed: b.failed,
        created: b.created, finished: b.finished, legacy_id: b.id, legacy: b.row,
      };
    });
    const { rows } = await target.query<{ inserted: boolean }>(
      `insert into public.broadcasts as n
         (pick_id, channels, subject, text_body, html_body, sms_body, status, error, email_cursor, sms_cursor, emails_sent, texts_sent,
          failed, created_at, finished_at, imported_from, legacy_id, legacy)
       select x.pick_id, x.channels, x.subject, x.text_body, x.html_body, x.sms_body, x.status, x.error, x.email_cursor, x.sms_cursor,
              x.emails_sent, x.texts_sent, x.failed, x.created::timestamptz, x.finished::timestamptz, 'data-site:broadcasts', x.legacy_id, x.legacy
         from jsonb_to_recordset($1::jsonb)
           as x(pick_id uuid, channels text[], subject text, text_body text, html_body text, sms_body text, status text, error text,
                email_cursor bigint, sms_cursor bigint, emails_sent int, texts_sent int, failed int, created text, finished text,
                legacy_id text, legacy jsonb)
       on conflict (imported_from, legacy_id) where imported_from is not null do update
         set status = excluded.status, error = excluded.error, emails_sent = excluded.emails_sent, texts_sent = excluded.texts_sent,
             failed = excluded.failed, finished_at = excluded.finished_at, legacy = excluded.legacy, pick_id = excluded.pick_id
       where n.legacy is distinct from excluded.legacy or n.pick_id is distinct from excluded.pick_id
       returning (xmax = 0) as inserted`,
      [JSON.stringify(out)],
    );
    const inserted = rows.filter((x) => x.inserted).length;
    r.inserted += inserted;
    r.refreshed += rows.length - inserted;
    skip(r, "already copied, unchanged", out.length - rows.length);
  });
  if (unfinished) r.notes.push(`${unfinished} sends were still running on the old site. Let them finish there, then run this again.`);
  r.targetAfter = await count(target, "public.broadcasts");
  return r;
}

/* -------------------------------------------------------------- inquiries */

async function stepInquiries(ctx: Ctx): Promise<StepReport> {
  const { target, site } = ctx;
  const r = blank("inquiries");
  if (!site || !(await isTable(site, "inquiries"))) {
    r.notes.push("No data-site database given: advertiser inquiries were not copied.");
    return r;
  }
  r.ran = true;
  r.targetBefore = await count(target, "public.inquiries");
  type Q = Record<string, string | null>;
  const q: PageQuery = {
    cols: `i.name, i.company, i.ticker, i.email, i.phone, i.package, i.message, i.ip,
           ${ts("i.created_at")} as created, ${ts("i.handled_at")} as handled, (to_jsonb(i)->>'notified_at') as notified`,
    from: "inquiries i", key: "i.id",
  };
  r.source = await readAll<Q>(ctx, site, "advertiser inquiries", q, async (page) => {
    const { rows } = await target.query<{ inserted: boolean }>(
      `insert into public.inquiries as n
         (name, company, ticker, email, phone, package, message, ip, created_at, handled_at, notified_at, imported_from, legacy_id)
       select x.name, x.company, x.ticker, x.email, x.phone, x.package, x.message, x.ip, x.created::timestamptz,
              x.handled::timestamptz, x.notified::timestamptz, 'data-site:inquiries', x.id
         from jsonb_to_recordset($1::jsonb)
           as x(id text, name text, company text, ticker text, email text, phone text, package text, message text, ip text,
                created text, handled text, notified text)
       on conflict (imported_from, legacy_id) where imported_from is not null do update
         set handled_at = excluded.handled_at, notified_at = excluded.notified_at
       where (n.handled_at, n.notified_at) is distinct from (excluded.handled_at, excluded.notified_at)
       returning (xmax = 0) as inserted`,
      [JSON.stringify(page)],
    );
    const inserted = rows.filter((x) => x.inserted).length;
    r.inserted += inserted;
    r.refreshed += rows.length - inserted;
    skip(r, "already copied, unchanged", page.length - rows.length);
  });
  r.targetAfter = await count(target, "public.inquiries");
  return r;
}

/* -------------------------------------------------------------------- run */

const RUNNERS: Record<StepName, (ctx: Ctx) => Promise<StepReport>> = {
  users: stepUsers, watchlists: stepWatchlists, filings: stepFilings, summaries: stepSummaries, news: stepNews,
  subscriptions: stepSubscriptions, picks: stepPicks, broadcasts: stepBroadcasts, inquiries: stepInquiries,
};

export async function runBackfill(target: Client, site: Client | null, opts: BackfillOptions = {}): Promise<BackfillReport> {
  const log = opts.log ?? (() => {});
  const ctx: Ctx = { target, site, batch: opts.batchSize ?? 2000, log, checks: [] };
  const steps: StepReport[] = [];

  // The steps tell "written in this run" from "written earlier" by the transaction's start time, so the
  // whole copy has to be one transaction. (A SET LOCAL only sticks inside one.)
  await target.query(`set local bigstocks.backfill = 'on'`);
  const inside = (await target.query(`select current_setting('bigstocks.backfill', true) as v`)).rows[0].v === "on";
  if (!inside) throw new Error("The copy must run inside a transaction: begin, runBackfill, then commit or rollback.");

  if (!opts.afterCutover && (await isTable(target, "backfill_runs"))) {
    const done = await target.query<{ day: string }>(
      `select to_char(ran_at at time zone 'UTC', 'YYYY-MM-DD') as day from public.backfill_runs where cutover order by ran_at desc limit 1`,
    );
    if (done.rows[0]) {
      throw new Error(
        `The switch-over copy already ran on ${done.rows[0].day}. Since then the new site holds the latest data, and copying ` +
          `again could put old data over newer changes. If the new site has not opened to visitors yet, run again with --after-cutover.`,
      );
    }
  }

  const companies = await count(target, "public.companies");
  if (!companies) {
    throw new Error("The company list is empty. Load it first (npm run companies:load), then run the copy.");
  }

  for (const name of STEPS) {
    if (opts.only && !opts.only.includes(name)) continue;
    if (opts.skip?.includes(name)) continue;
    if (CUTOVER_ONLY.includes(name) && !opts.cutover) {
      const r = blank(name);
      r.notes.push("Left for the switch-over: the old app still reads this table. Run with --cutover to include it.");
      steps.push(r);
      continue;
    }
    log(`${name}…`);
    steps.push(await RUNNERS[name](ctx));
  }

  // Every row read from the old tables is accounted for: copied, refreshed, left alone, or skipped for a stated reason.
  for (const s of steps.filter((x) => x.ran)) {
    const skipped = Object.values(s.skipped).reduce((a, b) => a + b, 0);
    if (s.step === "subscriptions" || s.step === "watchlists") continue; // one old row can become several rows, or several one
    const accounted = s.inserted + s.refreshed + s.leftAlone + skipped;
    ctx.checks.push({
      name: `${s.step}: every old row accounted for`,
      ok: accounted === s.source,
      detail: `${s.source} read; ${s.inserted} copied, ${s.refreshed} refreshed, ${s.leftAlone} left alone, ${skipped} skipped`,
    });
  }
  const users = steps.find((s) => s.step === "users" && s.ran);
  if (users) {
    const missing = await count(
      target,
      "public.profiles p",
      `where not exists (select 1 from public.users u where u.id = p.id and u.email = p.email
                            and u.display_name is not distinct from p.display_name and u.chat_banned = p.chat_banned)`,
    );
    ctx.checks.push({ name: "users: every profile has a matching account", ok: missing === 0, detail: missing ? `${missing} missing` : "all present" });
  }
  return { steps, checks: ctx.checks, ok: ctx.checks.every((c) => c.ok) };
}

/**
 * Keeps a record of a copy that is about to be committed: when it ran, whether it was the switch-over
 * run, and the full counts. The record is the evidence of what was moved, and a recorded switch-over
 * run is what stops the copy from being run again by accident.
 */
export async function recordBackfillRun(target: Client, report: BackfillReport, opts: { cutover: boolean }): Promise<void> {
  await target.query(`insert into public.backfill_runs (cutover, ok, report) values ($1, $2, $3::jsonb)`, [
    opts.cutover, report.ok, JSON.stringify(report),
  ]);
}
