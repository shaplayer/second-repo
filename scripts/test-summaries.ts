/**
 * Tests for the summary waiting list. Claude and the SEC are both replaced by fakes: nothing leaves
 * this machine.   npx tsx scripts/test-summaries.ts [--if-available]
 */
import assert from "node:assert/strict";
import type { Client } from "pg";
import { parseSummary, PROMPT_VERSION, SCHEMA, SummaryRefused, SYSTEM, userPrompt, type SummaryInput, type Summarizer } from "../lib/summaries/claude";
import { MAX_DOCUMENT_CHARS, processSummaryJobs, requestSummary, shorten } from "../lib/summaries/jobs";
import type { SecClient } from "../lib/sec/client";
import { finish, test } from "./testing";
import { withTestDatabase } from "./testing-db";

const AAPL = 320193;
const folder = (acc: string) => `https://www.sec.gov/Archives/edgar/data/${AAPL}/${acc.replace(/-/g, "")}`;
const good = { headline: "Sales rose 6% in the quarter", one_sentence: "Sales grew 6% from a year ago.", bullets: ["Sales were $94 billion.", "Profit rose 8%."], tone: "Good news", importance: "High" };

function fakeSec(pages: Record<string, string>): SecClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async text(url: string) {
      asked.push(url);
      if (!(url in pages)) throw new Error(`404 ${url}`);
      return pages[url];
    },
    async json<T>(url: string) {
      return JSON.parse(await this.text(url)) as T;
    },
    stats: () => ({ requests: asked.length, retries: 0, pausedUntil: null }),
  } as SecClient & { asked: string[] };
}

async function addFiling(db: Client, acc: string, form: string, opts: { primary?: string | null; items?: string[] } = {}) {
  await db.query(
    `insert into public.filings (accession, cik, form, items, accepted_at, filed_date, primary_url, index_url, category, primary_document, detail_checked_at)
     values ($1, $2, $3, $4, now(), current_date, $5, $6, $7, $8, $9)`,
    [acc, AAPL, form, opts.items ?? [], opts.primary ? `${folder(acc)}/${opts.primary}` : `${folder(acc)}/${acc}-index.htm`, `${folder(acc)}/${acc}-index.htm`,
      form === "4" ? "insider" : "earnings", opts.primary ?? null, form === "4" ? null : new Date()],
  );
}

async function main() {
  console.log("summary tests");

  await test("the prompt and answer format: plain English, no advice, no prices; a version number that changes with them", () => {
    assert.match(SYSTEM, /Do not tell the reader to buy, sell or hold/);
    assert.match(SYSTEM, /do not mention the stock price/);
    assert.deepEqual([...SCHEMA.required], ["headline", "one_sentence", "bullets", "tone", "importance"]);
    assert.equal(PROMPT_VERSION, 2);
    const input: SummaryInput = { company: "Apple Inc.", ticker: "AAPL", typeLabel: "Quarterly report", formCode: "10-Q", text: "TEXT", shortened: true };
    const p = userPrompt(input);
    assert.match(p, /Company: Apple Inc\. \(AAPL\)/);
    assert.match(p, /Document: Quarterly report \(official form 10-Q\)/);
    assert.match(p, /only its main parts are included/);
    assert.ok(!userPrompt({ ...input, shortened: false, formCode: null }).includes("main parts"));
  });

  await test("what comes back is checked: unreadable, empty or advice-like answers are not kept", () => {
    assert.deepEqual(parseSummary(JSON.stringify(good)), {
      headline: good.headline, oneSentence: good.one_sentence, bullets: good.bullets, tone: "Good news", importance: "High",
    });
    assert.throws(() => parseSummary("not json"), SummaryRefused);
    assert.throws(() => parseSummary(JSON.stringify({ ...good, headline: " " })), SummaryRefused);
    assert.throws(() => parseSummary(JSON.stringify({ ...good, one_sentence: "Investors should buy the stock now." })), /read like advice/);
    const odd = parseSummary(JSON.stringify({ ...good, tone: "Great", importance: "Huge", bullets: ["a", "b", "c", "d", "e", ""] }));
    assert.deepEqual([odd.tone, odd.importance, odd.bullets.length], ["Routine", "Medium", 4]);
  });

  await test("a very long document keeps its opening and its results sections, and is marked as shortened", () => {
    const short = shorten("x".repeat(1000));
    assert.deepEqual([short.shortened, short.text.length], [false, 1000]);
    const long =
      "OPENING " + "a".repeat(200_000) + " Management's Discussion and Analysis of Financial Condition and Results MDNA-BODY " + "b".repeat(300_000) +
      " Consolidated Statements of Operations INCOME-BODY " + "c".repeat(300_000);
    const cut = shorten(long);
    assert.equal(cut.shortened, true);
    assert.ok(cut.text.length <= MAX_DOCUMENT_CHARS);
    for (const part of ["OPENING", "MDNA-BODY", "INCOME-BODY", "part of the document is left out"]) assert.ok(cut.text.includes(part), part);
  });

  const ran = await withTestDatabase("summaries", async (db) => {
    const visitor = { visitor: "203.0.113.5" };

    await test("opening an item puts it on the list once; the page is told to wait", async () => {
      await addFiling(db, "0000320193-26-000201", "10-Q", { primary: "q.htm" });
      assert.deepEqual(await requestSummary(db, "f:0000320193-26-000201", visitor), { status: "pending" });
      assert.deepEqual(await requestSummary(db, "f:0000320193-26-000201", visitor), { status: "pending" });
      assert.equal(Number((await db.query(`select count(*) as n from public.summary_jobs`)).rows[0].n), 1);
      assert.equal((await requestSummary(db, "f:9999999999-26-000001", visitor)).status, "unavailable");
    });

    await test("the worker reads the document, saves the summary as AI-written with its model and version, and the page then gets it", async () => {
      const sec = fakeSec({ [`${folder("0000320193-26-000201")}/q.htm`]: `<html><body><p>${"Sales were $94 billion. ".repeat(20)}</p></body></html>` });
      const seen: SummaryInput[] = [];
      const summarizer: Summarizer = async (i) => {
        seen.push(i);
        return { ...parseSummary(JSON.stringify(good)), model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 90 };
      };
      assert.deepEqual(await processSummaryJobs(db, sec, { summarizer }), { written: 1, failed: 0, retrying: 0 });
      assert.deepEqual([seen[0].company, seen[0].ticker, seen[0].typeLabel, seen[0].formCode, seen[0].shortened], ["Apple Inc.", "AAPL", "Quarterly report", "10-Q", false]);
      assert.ok(seen[0].text.startsWith("Sales were $94 billion."));
      const row = (await db.query(`select kind, model, prompt_version, one_sentence, source_url, input_tokens, output_tokens, category from public.summaries`)).rows[0];
      assert.deepEqual(row, {
        kind: "ai", model: "claude-opus-5-5", prompt_version: 2, one_sentence: "Sales grew 6% from a year ago.",
        source_url: `${folder("0000320193-26-000201")}/q.htm`, input_tokens: 1200, output_tokens: 90, category: "earnings",
      });
      const state = await requestSummary(db, "f:0000320193-26-000201", visitor);
      assert.equal(state.status, "ready");
      if (state.status === "ready") assert.deepEqual([state.item.headline, state.item.summary?.kind], ["Sales rose 6% in the quarter", "ai"]);
      assert.deepEqual(await processSummaryJobs(db, sec, { summarizer }), { written: 0, failed: 0, retrying: 0 }, "nothing is written twice");
    });

    await test("a filing known only by its document list has its main document found first; company news uses the attached press release", async () => {
      const acc = "0000320193-26-000202";
      await addFiling(db, acc, "8-K", { items: ["2.02"] });
      await db.query(
        `insert into public.news (source, accession, exhibit, cik, ticker, company_name, title, body_text, url, published_at)
         values ('sec', $1, 'EX-99.1', $2, 'AAPL', 'Apple Inc.', 'Apple reports results', $3, $4, now())`,
        [acc, AAPL, "PRESS RELEASE BODY " + "Revenue grew. ".repeat(30), `${folder(acc)}/ex991.htm`],
      );
      const index = `<table class="tableFile" summary="Document Format Files"><tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
        <tr><td>1</td><td>8-K</td><td><a href="/ix?doc=/Archives/edgar/data/${AAPL}/${acc.replace(/-/g, "")}/main8k.htm">main8k.htm</a></td><td>8-K</td><td>1</td></tr>
        <tr><td>2</td><td>EX-99.1</td><td><a href="/Archives/edgar/data/${AAPL}/${acc.replace(/-/g, "")}/ex991.htm">ex991.htm</a></td><td>EX-99.1</td><td>1</td></tr></table>`;
      const sec = fakeSec({ [`${folder(acc)}/${acc}-index.htm`]: index, [`${folder(acc)}/main8k.htm`]: "<p>COVER PAGE of the current report.</p>" });
      await requestSummary(db, `f:${acc}`, visitor);
      let got = "";
      const summarizer: Summarizer = async (i) => {
        got = i.text;
        return { ...parseSummary(JSON.stringify(good)), model: "claude-opus-5-5", inputTokens: 1, outputTokens: 1 };
      };
      assert.equal((await processSummaryJobs(db, sec, { summarizer })).written, 1);
      assert.ok(got.includes("COVER PAGE") && got.includes("=== Attached press release ===") && got.includes("PRESS RELEASE BODY"));
      assert.equal((await db.query(`select primary_document from public.filings where accession = $1`, [acc])).rows[0].primary_document, "main8k.htm");
    });

    await test("a passing failure is retried later; a refusal is final; after three tries it gives up; the page says so plainly", async () => {
      await addFiling(db, "0000320193-26-000203", "10-K", { primary: "k.htm" });
      await addFiling(db, "0000320193-26-000204", "10-K", { primary: "k.htm" });
      const sec = fakeSec({
        [`${folder("0000320193-26-000203")}/k.htm`]: "<p>" + "Annual results. ".repeat(40) + "</p>",
        [`${folder("0000320193-26-000204")}/k.htm`]: "<p>" + "Annual results. ".repeat(40) + "</p>",
      });
      await requestSummary(db, "f:0000320193-26-000203", visitor);
      const flaky: Summarizer = async () => { throw new Error("529 overloaded"); };
      assert.deepEqual(await processSummaryJobs(db, sec, { summarizer: flaky }), { written: 0, failed: 0, retrying: 1 });
      assert.deepEqual(await processSummaryJobs(db, sec, { summarizer: flaky }), { written: 0, failed: 0, retrying: 0 }, "not before its retry time");
      for (let i = 0; i < 3; i++) {
        await db.query(`update public.summary_jobs set next_attempt_at = now() where status = 'queued'`);
        await processSummaryJobs(db, sec, { summarizer: flaky });
      }
      assert.equal((await db.query(`select status, attempts from public.summary_jobs where accession = '0000320193-26-000203'`)).rows[0].status, "failed");
      const told = await requestSummary(db, "f:0000320193-26-000203", visitor);
      assert.equal(told.status, "unavailable");
      await requestSummary(db, "f:0000320193-26-000204", visitor);
      const refuses: Summarizer = async () => { throw new SummaryRefused("Claude declined to summarize this document."); };
      assert.deepEqual(await processSummaryJobs(db, sec, { summarizer: refuses }), { written: 0, failed: 1, retrying: 0 });
      assert.equal(Number((await db.query(`select count(*) as n from public.summaries where accession in ('0000320193-26-000203', '0000320193-26-000204')`)).rows[0].n), 0);
    });

    await test("insider trades never go to AI, and sources that don't allow it are never summarised", async () => {
      await addFiling(db, "0000320193-26-000205", "4");
      assert.deepEqual(await requestSummary(db, "f:0000320193-26-000205", visitor), { status: "pending" });
      assert.equal(Number((await db.query(`select count(*) as n from public.summary_jobs where accession = '0000320193-26-000205'`)).rows[0].n), 0);
      await db.query(`update public.filings set detail_checked_at = now() where accession = '0000320193-26-000205'`);
      assert.equal((await requestSummary(db, "f:0000320193-26-000205", visitor)).status, "unavailable");
      const n = await db.query(
        `insert into public.news (source, cik, ticker, company_name, title, url, published_at)
         values ('prnewswire', $1, 'AAPL', 'Apple', 'Apple announces', 'https://www.prnewswire.com/news-releases/a.html', now()) returning id`, [AAPL]);
      const state = await requestSummary(db, `n:${n.rows[0].id}`, visitor);
      assert.equal(state.status, "unavailable");
      assert.equal(Number((await db.query(`select count(*) as n from public.summary_jobs where news_id is not null`)).rows[0].n), 0);
    });

    await test("one visitor cannot run up the bill: new summaries stop at the hourly limit", async () => {
      let pending = 0;
      for (let i = 0; i < 45; i++) {
        const acc = `0000320193-26-${String(300 + i).padStart(6, "0")}`;
        await addFiling(db, acc, "10-Q", { primary: "q.htm" });
        if ((await requestSummary(db, `f:${acc}`, { visitor: "198.51.100.77" })).status === "pending") pending++;
      }
      assert.equal(pending, 40);
    });
  }, { ifAvailable: process.argv.includes("--if-available") });

  if (!ran) console.log("(database part skipped)");
  if (!finish("summary tests")) process.exit(1);
}

main().catch((e) => {
  console.error("summary tests could not run:", (e as Error).message);
  process.exit(1);
});
