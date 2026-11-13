/**
 * Reads the SEC's "latest filings" feed and stores every new filing of a kind the site collects.
 * Safe to run again at any time: the accession number is the key, so a filing is stored once.
 */
import { baseForm, filingCategory, isCollectedForm } from "../plain";
import type { SecClient } from "../sec/client";
import { currentFeedUrl, newYorkDate, parseCurrentFeed, type CurrentEntry } from "../sec/current-feed";
import type { Db } from "./db";

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;
/** After a day or more with nothing stored (first start, or the worker was down) read much further back. */
const CATCH_UP_MAX_PAGES = 40;

export type PollOptions = {
  maxPages?: number;
  /** The current time (tests only). */
  now?: Date;
};

/** Which of a filing's parties is the company the filing is about, best first. */
function rolePreference(form: string): CurrentEntry["role"][] {
  const { base } = baseForm(form);
  // An insider trade belongs to the company whose shares were traded, never to the person reporting it.
  if (base === "4") return ["issuer"];
  // A big investor's report is about the company invested in ("Subject"), not the investor ("Filed by").
  if (base === "SC 13D" || base === "SCHEDULE 13D") return ["subject"];
  return ["filer", "subject", "issuer"];
}

type Known = { exchange: string | null; ticker: string | null };

/** One entry per filing: the party the filing is about, or nothing when that party is not on this page. */
function chooseEntries(entries: CurrentEntry[], known: Map<number, Known>): CurrentEntry[] {
  const byAccession = new Map<string, CurrentEntry[]>();
  for (const e of entries) {
    if (!isCollectedForm(e.form)) continue;
    const list = byAccession.get(e.accession);
    if (list) list.push(e);
    else byAccession.set(e.accession, [e]);
  }
  const out: CurrentEntry[] = [];
  for (const group of byAccession.values()) {
    for (const role of rolePreference(group[0].form)) {
      const candidates = group.filter((e) => e.role === role);
      if (!candidates.length) continue;
      // Several companies can file one document together: keep the one people can look up by ticker.
      out.push(candidates.find((e) => known.get(e.cik)?.ticker) ?? candidates.find((e) => known.has(e.cik)) ?? candidates[0]);
      break;
    }
  }
  return out;
}

export async function pollCurrentFilings(
  db: Db,
  sec: SecClient,
  opts: PollOptions = {},
): Promise<{ fetchedPages: number; newFilings: string[] }> {
  const now = opts.now ?? new Date();
  let maxPages = opts.maxPages;
  if (maxPages === undefined) {
    const recent = await db.query(`select 1 from public.filings where accepted_at > $1::timestamptz - interval '1 day' limit 1`, [now.toISOString()]);
    maxPages = recent.rowCount ? DEFAULT_MAX_PAGES : CATCH_UP_MAX_PAGES;
  }
  maxPages = Math.max(1, Math.floor(maxPages));

  const newFilings: string[] = [];
  let fetchedPages = 0;
  for (let page = 0; page < maxPages; page++) {
    const xml = await sec.text(currentFeedUrl(page * PAGE_SIZE, PAGE_SIZE));
    fetchedPages++;
    const listed = (xml.match(/<entry\b/gi) ?? []).length;
    if (listed === 0) break;
    const entries = parseCurrentFeed(xml);

    const ciks = [...new Set(entries.filter((e) => isCollectedForm(e.form)).map((e) => e.cik))];
    const known = new Map<number, Known>();
    if (ciks.length) {
      const { rows } = await db.query<{ cik: string; exchange: string | null; ticker: string | null }>(
        `select cik, exchange, ticker from public.companies where cik = any($1::bigint[])`,
        [ciks],
      );
      for (const r of rows) known.set(Number(r.cik), { exchange: r.exchange, ticker: r.ticker });
    }

    const chosen = chooseEntries(entries, known);
    if (chosen.length) {
      const { rows: have } = await db.query<{ accession: string }>(
        `select accession from public.filings where accession = any($1::text[])`,
        [chosen.map((e) => e.accession)],
      );
      const stored = new Set(have.map((r) => r.accession));
      const fresh = chosen.filter((e) => !stored.has(e.accession));
      // A page with nothing new on it: everything older is already here.
      if (!fresh.length) break;

      const strangers = new Map<number, string>();
      for (const e of fresh) if (!known.has(e.cik) && !strangers.has(e.cik)) strangers.set(e.cik, e.companyName.slice(0, 300));
      if (strangers.size) {
        await db.query(
          `insert into public.companies (cik, name)
           select x.cik, x.name from jsonb_to_recordset($1::jsonb) as x(cik bigint, name text)
           on conflict (cik) do nothing`,
          [JSON.stringify([...strangers].map(([cik, name]) => ({ cik, name })))],
        );
      }

      const rows = fresh.map((e) => {
        const exchange = known.get(e.cik)?.exchange;
        return {
          accession: e.accession,
          cik: e.cik,
          form: e.form,
          items: e.items,
          accepted_at: e.acceptedAt,
          filed_date: /^\d{4}-\d{2}-\d{2}$/.test(e.filedDate) ? e.filedDate : newYorkDate(e.acceptedAt),
          index_url: e.indexUrl,
          category: filingCategory({ form: e.form, items: e.items }, { listed: Boolean(exchange && exchange.trim()) }),
        };
      });
      const inserted = await db.query<{ accession: string }>(
        `insert into public.filings (accession, cik, form, items, accepted_at, filed_date, primary_url, index_url, category)
         select x.accession, x.cik, x.form, array(select jsonb_array_elements_text(x.items)), x.accepted_at, x.filed_date,
                x.index_url, x.index_url, x.category
           from jsonb_to_recordset($1::jsonb)
             as x(accession text, cik bigint, form text, items jsonb, accepted_at timestamptz, filed_date date, index_url text, category text)
         on conflict (accession) do nothing
         returning accession`,
        [JSON.stringify(rows)],
      );
      for (const r of inserted.rows) newFilings.push(r.accession);
    }
    if (listed < PAGE_SIZE) break; // the feed has no more pages
  }
  return { fetchedPages, newFilings };
}
