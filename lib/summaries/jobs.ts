/**
 * The summary waiting list (plan Phase 3, decision 4): a summary is written only for an item someone
 * opened, or for a company with active alert subscriptions. Nothing market-wide.
 *
 * - A page never calls Claude. It asks requestSummary(), which answers from the database or puts the
 *   item on the list; the worker's processSummaryJobs() does the writing.
 * - An item is on the list at most once (the table's unique rules), and a job is claimed with a row
 *   lock, so two workers never write the same summary.
 * - Insider trades are summarised from the filing's own data by the ingestion worker, without AI.
 * - Sources that do not allow it are never summarised.
 */
import type { Client, Pool, PoolClient } from "pg";
import { getFeedItem, type FeedItem } from "../data/feed";
import { allow, LIMITS } from "../limits";
import { baseForm } from "../plain";
import type { SecClient } from "../sec/client";
import { parseFilingIndexHtml, pickPrimary } from "../sec/filing-index";
import { htmlToText } from "../sec/text";
import { PROMPT_VERSION, SummaryRefused, summarizeWithClaude, type Summarizer } from "./claude";

type Db = Pool | PoolClient | Client;

export type SummaryState =
  | { status: "ready"; item: FeedItem }
  /** Being written: ask again in a few seconds. */
  | { status: "pending" }
  /** There will be no summary for this item; `reason` is plain English for the reader. */
  | { status: "unavailable"; reason: string };

const NOT_ALLOWED = "This source doesn't let us summarize its releases. The headline links to the original.";
const FAILED = "We couldn't write a summary for this one. The original has the full details.";
const BUSY = "Summaries are busy right now. Try again in a little while, or read the original.";

/**
 * Called when someone opens an item. Returns the summary if there is one, otherwise puts the item on
 * the waiting list (within the limits that keep one visitor, or a flood of them, from running up the bill).
 */
export async function requestSummary(db: Db, id: string, opts: { visitor: string | null }): Promise<SummaryState> {
  const item = await getFeedItem(db, id);
  if (!item) return { status: "unavailable", reason: "We couldn't find that item." };
  if (item.summary) return { status: "ready", item };
  if (!item.canSummarize) return { status: "unavailable", reason: NOT_ALLOWED };
  const ref = id.slice(2);

  if (item.kind === "filing" && baseForm(item.formCode ?? "").base === "4") {
    // Built by the ingestion worker from the filing's own data. If it has already tried, there is nothing more to wait for.
    const { rows } = await db.query<{ checked: boolean }>(`select detail_checked_at is not null as checked from public.filings where accession = $1`, [ref]);
    return rows[0]?.checked ? { status: "unavailable", reason: FAILED } : { status: "pending" };
  }
  if (item.kind === "release") {
    const { rows } = await db.query<{ has_text: boolean }>(`select body_text is not null as has_text from public.news where id = $1`, [ref]);
    if (!rows[0]?.has_text) return { status: "unavailable", reason: NOT_ALLOWED };
  }

  const col = item.kind === "filing" ? "accession" : "news_id";
  const job = await db.query<{ status: string }>(`select status from public.summary_jobs where ${col} = $1`, [ref]);
  if (job.rows[0]) {
    return job.rows[0].status === "queued" || job.rows[0].status === "working" ? { status: "pending" } : { status: "unavailable", reason: FAILED };
  }
  if (!(await allow(db, LIMITS.summaryPerVisitor, opts.visitor ?? "unknown")) || !(await allow(db, LIMITS.summaryPerDay, "all"))) {
    return { status: "unavailable", reason: BUSY };
  }
  await db.query(`insert into public.summary_jobs (${col}, reason) values ($1, 'viewed') on conflict do nothing`, [ref]);
  return { status: "pending" };
}

/** Very long documents: keep the opening and the parts with the results, and say so in the prompt. */
export const MAX_DOCUMENT_CHARS = 400_000;

export function shorten(text: string): { text: string; shortened: boolean } {
  if (text.length <= MAX_DOCUMENT_CHARS) return { text, shortened: false };
  const gap = "\n\n[... part of the document is left out here ...]\n\n";
  const parts = [text.slice(0, 80_000)];
  let used = 80_000;
  // The sections an investor cares about most, in a yearly or quarterly report.
  const wanted: [RegExp, number][] = [
    [/management.s discussion and analysis of financial condition/gi, 180_000],
    [/consolidated statements? of (operations|income|comprehensive (income|loss))/gi, 60_000],
    [/consolidated balance sheets?/gi, 40_000],
    [/consolidated statements? of cash flows/gi, 30_000],
  ];
  for (const [re, size] of wanted) {
    // The last mention is usually the section itself; earlier ones are the table of contents.
    let at = -1;
    for (const m of text.matchAll(re)) if ((m.index ?? 0) >= used) at = m.index ?? -1;
    if (at < 0) continue;
    parts.push(text.slice(at, at + size));
    used = Math.max(used, at + size);
  }
  if (parts.length === 1) parts.push(text.slice(-120_000));
  return { text: parts.join(gap).slice(0, MAX_DOCUMENT_CHARS), shortened: true };
}

type Job = { id: string; accession: string | null; news_id: string | null; attempts: number };

async function documentFor(db: Db, sec: SecClient, job: Job): Promise<{ text: string; sourceUrl: string; category: string } | null> {
  if (job.news_id) {
    const { rows } = await db.query<{ body_text: string | null; url: string; ok: boolean }>(
      `select n.body_text, n.url, src.can_summarize as ok from public.news n join public.news_sources src on src.key = n.source where n.id = $1`,
      [job.news_id],
    );
    const n = rows[0];
    if (!n || !n.ok || !n.body_text?.trim()) return null;
    return { text: n.body_text, sourceUrl: n.url, category: "press" };
  }
  const { rows } = await db.query<{
    form: string; index_url: string; primary_url: string; primary_document: string | null; category: string | null; exhibit: string | null;
  }>(
    `select f.form, f.index_url, f.primary_url, f.primary_document, f.category,
            (select body_text from public.news n where n.accession = f.accession and n.source = 'sec' order by n.exhibit limit 1) as exhibit
       from public.filings f where f.accession = $1`,
    [job.accession],
  );
  const f = rows[0];
  if (!f) return null;
  let url = f.primary_url;
  if (!f.primary_document) {
    // The feed only gave us the page that lists the filing's documents: find the main one.
    const main = pickPrimary(parseFilingIndexHtml(await sec.text(f.index_url)), f.form);
    if (main) {
      url = main.url;
      await db.query(`update public.filings set primary_url = $2, primary_document = $3 where accession = $1`, [job.accession, main.url, main.name]);
    } else if (!f.exhibit) return null;
  }
  let main = "";
  if (/\.(html?|txt)$/i.test(url) && !url.endsWith("-index.htm")) main = htmlToText(await sec.text(url));
  const { base } = baseForm(f.form);
  // For company news the announcement itself is usually the attached press release; the cover filing is short boilerplate.
  const text = f.exhibit && (base === "8-K" || base === "6-K")
    ? `${main.slice(0, 30_000)}\n\n=== Attached press release ===\n${f.exhibit}`
    : main || f.exhibit || "";
  if (text.trim().length < 200) return null;
  return { text, sourceUrl: url, category: f.category ?? "news" };
}

export type ProcessResult = { written: number; failed: number; retrying: number };

/**
 * Writes summaries for waiting items, subscribed companies first. Call it again while it reports work.
 * `summarizer` is replaceable so tests never call Claude.
 */
export async function processSummaryJobs(
  db: Db, sec: SecClient, opts: { limit?: number; summarizer?: Summarizer } = {},
): Promise<ProcessResult> {
  const summarize = opts.summarizer ?? summarizeWithClaude;
  const result: ProcessResult = { written: 0, failed: 0, retrying: 0 };
  // A job claimed long ago and never finished (the worker stopped mid-way) goes back on the list.
  await db.query(`update public.summary_jobs set status = 'queued' where status = 'working' and claimed_at < now() - interval '10 minutes'`);

  for (let i = 0; i < (opts.limit ?? 5); i++) {
    const claimed = await db.query<Job>(
      `update public.summary_jobs j set status = 'working', claimed_at = now(), attempts = j.attempts + 1
        where j.id = (select id from public.summary_jobs
                       where status = 'queued' and next_attempt_at <= now()
                       order by (reason = 'subscribed') desc, created_at, id
                       limit 1 for update skip locked)
        returning j.id::text as id, j.accession, j.news_id::text as news_id, j.attempts`,
    );
    const job = claimed.rows[0];
    if (!job) break;
    const finish = (status: "done" | "failed" | "queued", error: string | null, retryMinutes = 0) =>
      db.query(
        `update public.summary_jobs set status = $2, error = $3, finished_at = case when $2 = 'queued' then null else now() end,
                next_attempt_at = now() + make_interval(mins => $4) where id = $1`,
        [job.id, status, error?.slice(0, 500) ?? null, retryMinutes],
      );
    try {
      const item = await getFeedItem(db, job.accession ? `f:${job.accession}` : `n:${job.news_id}`);
      const doc = item ? await documentFor(db, sec, job) : null;
      if (!item || !doc) {
        await finish("failed", "no readable text for this item");
        result.failed++;
        continue;
      }
      const cut = shorten(doc.text);
      const s = await summarize({
        company: item.company, ticker: item.ticker, typeLabel: item.typeLabel, formCode: item.formCode, text: cut.text, shortened: cut.shortened,
      });
      await db.query(
        `insert into public.summaries
           (accession, news_id, kind, model, prompt_version, headline, one_sentence, bullets, why_it_matters, tone, importance, category,
            source_url, input_tokens, output_tokens)
         values ($1, $2, 'ai', $3, $4, $5, $6, $7, '', $8, $9, $10, $11, $12, $13)
         on conflict do nothing`,
        [job.accession, job.news_id, s.model, PROMPT_VERSION, s.headline, s.oneSentence, s.bullets, s.tone, s.importance, doc.category,
          doc.sourceUrl, s.inputTokens, s.outputTokens],
      );
      await finish("done", null);
      result.written++;
    } catch (e) {
      const message = (e as Error).message;
      if (e instanceof SummaryRefused || job.attempts >= 3) {
        await finish("failed", message);
        result.failed++;
      } else {
        await finish("queued", message, job.attempts === 1 ? 2 : 10);
        result.retrying++;
      }
    }
  }
  return result;
}
