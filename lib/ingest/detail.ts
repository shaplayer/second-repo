/**
 * The second look at a new filing: which document is the main one, the press release attached to a
 * company-news filing (it becomes a row in news and gives the filing its headline), and the
 * plain-English summary of an insider trade, built from the filing's own numbers with no AI.
 * Safe to run again: every write is keyed on the accession number.
 */
import { baseForm, plainHeadline } from "../plain";
import type { SecClient } from "../sec/client";
import {
  documentsFromFolder,
  filingFolderUrl,
  filingIndexUrl,
  parseFilingIndexHtml,
  parseFolderJson,
  pickPressRelease,
  pickPrimary,
  rawXmlUrl,
  type FilingDocument,
} from "../sec/filing-index";
import { insiderSummary, parseForm4 } from "../sec/form4";
import { htmlToText, releaseTitle } from "../sec/text";
import { shortError, type Db } from "./db";

export const MAX_BODY_CHARS = 200_000;
/** The forms whose documents are read. Every other form is only marked as looked at. */
const DETAIL_FORMS = ["8-K", "6-K", "4"];
const BASE_FORM_SQL = `upper(regexp_replace(btrim(form), '/A$', '', 'i'))`;

export type DetailOptions = {
  limit?: number;
  maxAgeHours?: number;
  /** The current time (tests only). */
  now?: Date;
};

type Todo = {
  accession: string;
  cik: string;
  form: string;
  items: string[] | null;
  accepted_at: Date;
  index_url: string;
  primary_url: string;
  company_name: string;
  ticker: string | null;
  exchange: string | null;
};

async function listDocuments(sec: SecClient, f: Todo): Promise<FilingDocument[]> {
  const cik = Number(f.cik);
  let firstError: unknown = null;
  try {
    const indexUrl = /-index\.html?$/i.test(f.index_url) ? f.index_url : filingIndexUrl(cik, f.accession);
    const docs = parseFilingIndexHtml(await sec.text(indexUrl));
    if (docs.length) return docs;
  } catch (e) {
    firstError = e;
  }
  // The index page could not be read, or listed nothing: fall back to the folder's plain file list.
  const folder = filingFolderUrl(cik, f.accession);
  try {
    const docs = documentsFromFolder(parseFolderJson(await sec.json(folder + "index.json"), folder), f.form);
    if (docs.length) return docs;
  } catch (e) {
    throw firstError ?? e;
  }
  throw firstError ?? new Error("The filing lists no documents");
}

async function processOne(db: Db, sec: SecClient, f: Todo): Promise<void> {
  const cik = Number(f.cik);
  const { base } = baseForm(f.form);
  const docs = await listDocuments(sec, f);
  const primary = pickPrimary(docs, f.form);
  const primaryUrl = primary?.url ?? f.primary_url;
  const primaryDocument = primary ? primary.name.slice(primary.name.lastIndexOf("/") + 1) : null;
  let title: string | null = null;

  if (base === "8-K" || base === "6-K") {
    const release = pickPressRelease(docs);
    if (release) {
      const html = await sec.text(release.url);
      const text = htmlToText(html);
      if (text) {
        title = releaseTitle(htmlToText(html, { layout: true }), f.company_name);
        const listed = Boolean(f.exchange && f.exchange.trim());
        await db.query(
          `insert into public.news (source, accession, exhibit, cik, ticker, company_name, title, body_text, url, published_at)
           values ('sec', $1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict do nothing`,
          [
            f.accession,
            release.type,
            cik,
            f.ticker,
            f.company_name,
            title ?? plainHeadline({ form: f.form, items: f.items ?? [] }, { listed }),
            text.slice(0, MAX_BODY_CHARS),
            release.url,
            f.accepted_at,
          ],
        );
      }
    }
  } else if (base === "4") {
    const data = docs.find((d) => baseForm(d.type).base === "4" && /\.xml$/i.test(d.name)) ?? (primary && /\.xml$/i.test(primary.name) ? primary : null);
    if (data) {
      const form4 = parseForm4(await sec.text(rawXmlUrl(data)));
      if (form4.owner || form4.trades.length) {
        const s = insiderSummary(form4.trades, form4);
        await db.query(
          `insert into public.summaries
             (accession, kind, model, prompt_version, headline, one_sentence, bullets, why_it_matters, tone, importance, category, source_url)
           values ($1, 'rule', null, 1, $2, $3, $4::text[], $5, $6, $7, 'insider', $8)
           on conflict (accession) do nothing`,
          [f.accession, s.headline, s.oneSentence, s.bullets, s.whyItMatters, s.tone, s.importance, primaryUrl],
        );
      }
    }
  }

  await db.query(
    `update public.filings
        set primary_url = $2, primary_document = coalesce($3, primary_document), title = coalesce($4, title),
            detail_checked_at = now(), detail_error = null
      where accession = $1`,
    [f.accession, primaryUrl, primaryDocument, title],
  );
}

/**
 * Works through filings that have not had their second look, newest first.
 * `done` counts the filings whose documents were read this time; `failed` those that will be tried again.
 */
export async function processFilingDetails(db: Db, sec: SecClient, opts: DetailOptions = {}): Promise<{ done: number; failed: number }> {
  const limit = Math.max(1, Math.floor(opts.limit ?? 25));
  const maxAgeHours = Math.max(0, opts.maxAgeHours ?? 72);
  const cutoff = new Date((opts.now ?? new Date()).getTime() - maxAgeHours * 3600_000).toISOString();

  // Forms with nothing to read, and filings too old to be worth another try, are closed straight away.
  await db.query(
    `update public.filings set detail_checked_at = now()
      where detail_checked_at is null and (${BASE_FORM_SQL} <> all($1::text[]) or accepted_at < $2::timestamptz)`,
    [DETAIL_FORMS, cutoff],
  );
  if (sec.stats().pausedUntil !== null) return { done: 0, failed: 0 };

  // Filings never tried come before the ones being tried again, so a stubborn failure cannot hold up the rest.
  const { rows } = await db.query<Todo>(
    `select f.accession, f.cik, f.form, f.items, f.accepted_at, f.index_url, f.primary_url,
            c.name as company_name, c.ticker, c.exchange
       from public.filings f join public.companies c on c.cik = f.cik
      where f.detail_checked_at is null and f.accepted_at >= $1::timestamptz
      order by (f.detail_error is not null), f.accepted_at desc
      limit $2`,
    [cutoff, limit],
  );

  let done = 0;
  let failed = 0;
  for (const f of rows) {
    try {
      await processOne(db, sec, f);
      done++;
    } catch (e) {
      failed++;
      await db
        .query(`update public.filings set detail_error = $2 where accession = $1`, [f.accession, shortError(e)])
        .catch((err) => console.error(`[detail] could not record the error for ${f.accession}: ${shortError(err)}`));
      // The SEC has told us to stop: leave the rest for the next run.
      if (sec.stats().pausedUntil !== null) break;
    }
  }
  return { done, failed };
}
