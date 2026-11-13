/**
 * Runs the whole worker once, end to end, on a throwaway local database, with stand-ins for the SEC,
 * the newswires, Claude and the email service. Nothing leaves this machine.
 *
 *   npx tsx scripts/test-worker.ts [--if-available]
 *
 * The individual jobs have their own tests; this one proves they work together: a filing arrives,
 * a follower is alerted by email with the summary, and every job reports that it worked.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { confirmSignup, signUp } from "../lib/alerts/subscriptions";
import type { EmailMessage } from "../lib/email";
import { SecHttpError, type SecClient } from "../lib/sec/client";
import { SEC_TICKERS_EXCHANGE_URL } from "../lib/sec/companies";
import { parseSummary } from "../lib/summaries/claude";
import { finish, test } from "./testing";
import { withTestDatabase } from "./testing-db";
import { runWorker } from "./worker";

const fixture = (name: string) => readFileSync(`lib/sec/fixtures/${name}`, "utf8");

async function main() {
  process.env.COMPANY_POSTAL_ADDRESS = "BigStocks Test LLC, 1 Test Way, Testville, TS 12345";
  process.env.NEXT_PUBLIC_SITE_URL = "https://bigstocks.test";
  process.env.EMAIL_PROVIDER = "console";
  console.log("worker test");

  const ran = await withTestDatabase("worker", async (client, url) => {
    const db = new Pool({ connectionString: url, max: 4 });
    const asked: string[] = [];
    // A stand-in for the SEC: the saved "latest filings" page, the company list, and "not found" for everything else.
    const sec: SecClient = {
      async text(u: string) {
        asked.push(u);
        if (u.includes("action=getcurrent")) return u.includes("start=0") ? fixture("current-feed.xml") : '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';
        if (u === SEC_TICKERS_EXCHANGE_URL) return readFileSync("scripts/fixtures/company_tickers_exchange.sample.json", "utf8");
        throw new SecHttpError(404, u);
      },
      async json<T>(u: string) {
        return JSON.parse(await this.text(u)) as T;
      },
      stats: () => ({ requests: asked.length, retries: 0, pausedUntil: null }),
    };
    const pressFetch = (async () => new Response(fixture("press-rss.xml"), { status: 200, headers: { "content-type": "application/rss+xml" } })) as typeof fetch;
    const mail: EmailMessage[] = [];
    const log = console.log;
    const errors: string[] = [];
    const realError = console.error;

    try {
      // Someone follows every company that appears in the saved feed, so the first filing of each makes an alert.
      const first = readFileSync("lib/sec/fixtures/current-feed.xml", "utf8");
      const ciks = [...new Set([...first.matchAll(/\((\d{10})\) \((Filer|Issuer|Subject)\)/g)].map((m) => Number(m[1])))];
      assert.ok(ciks.length > 0, "the saved feed names at least one company");

      await test("run once: filings arrive, are classified and matched; every job reports that it worked", async () => {
        console.log = (...a: unknown[]) => {
          const line = a.join(" ");
          const m = /^\[email:console\] to=(\S+) subject=(".*")\n([\s\S]*)$/.exec(line);
          if (m) mail.push({ to: [m[1]], subject: JSON.parse(m[2]), text: m[3] });
        };
        console.error = (...a: unknown[]) => { errors.push(a.join(" ")); };
        await runWorker({ db, sec, sending: true, summaries: true, once: true, pressFetch,
          summarizer: async () => ({ ...parseSummary(JSON.stringify({ headline: "Something happened", one_sentence: "It happened, in one sentence.", bullets: ["A fact."], tone: "Routine", importance: "Medium" })), model: "claude-opus-5-5", inputTokens: 1, outputTokens: 1 }) });
        console.log = log;
        console.error = realError;
        const filings = Number((await db.query(`select count(*) as n from public.filings`)).rows[0].n);
        assert.ok(filings > 0, "filings were stored");
        assert.equal(Number((await db.query(`select count(*) as n from public.filings where category is null`)).rows[0].n), 0, "every stored filing is classified");
        assert.equal(Number((await db.query(`select count(*) as n from public.filings where matched_at is null`)).rows[0].n), 0, "every stored filing was looked at for alerts");
        const jobs = (await db.query(`select job, last_success_at is not null as worked, last_error from public.job_state where job not like '%:last' order by job`)).rows;
        assert.deepEqual(jobs.map((j) => j.job), ["companies", "details", "digest", "filings", "housekeeping", "match", "nightly", "press", "send", "summaries"]);
        for (const j of jobs) assert.ok(j.worked, `${j.job} did not report success: ${j.last_error}`);
        assert.ok(asked.every((u) => /^https:\/\/(www|data)\.sec\.gov\//.test(u)), "the SEC client was only asked for SEC addresses");
        assert.ok(Number((await db.query(`select count(*) as n from public.news where source <> 'sec'`)).rows[0].n) > 0, "newswire headlines were stored");
      });

      await test("a second pass with a follower: the next filing reaches them by email, once", async () => {
        const cik = Number((await db.query(`select cik from public.filings where category in ('news', 'earnings') order by accepted_at desc limit 1`)).rows[0].cik);
        const r = await signUp(client, { email: "follower@example.org", cik, picks: false, source: "test", consentText: "x", ip: null, userAgent: null });
        await confirmSignup(client, r.confirmToken!, { ip: null, userAgent: null });
        // The same filing "arrives again" as new: forget that it was matched, and make it fresh.
        await db.query(`update public.filings set matched_at = null, accepted_at = now() - interval '1 minute' where cik = $1`, [cik]);
        mail.length = 0;
        console.log = (...a: unknown[]) => {
          const m = /^\[email:console\] to=(\S+) subject=(".*")\n([\s\S]*)$/.exec(a.join(" "));
          if (m) mail.push({ to: [m[1]], subject: JSON.parse(m[2]), text: m[3] });
        };
        const summarizer = async () => ({ ...parseSummary(JSON.stringify({ headline: "Something happened", one_sentence: "It happened, in one sentence.", bullets: ["A fact."], tone: "Routine", importance: "Medium" })), model: "claude-opus-5-5", inputTokens: 1, outputTokens: 1 });
        await runWorker({ db, sec, sending: true, summaries: true, once: true, pressFetch, summarizer });
        // The summary may not be readable from the stand-in SEC (it answers "not found"), so the alert waits out its
        // short grace period; age the events and run the sender again, as the passing of 90 seconds would.
        await db.query(`update public.alert_events set created_at = now() - interval '2 minutes' where status = 'queued'`);
        await runWorker({ db, sec, sending: true, summaries: false, once: true, pressFetch });
        console.log = log;
        const toFollower = mail.filter((m) => m.to[0] === "follower@example.org");
        const events = Number((await db.query(`select count(*) as n from public.alert_events where status = 'sent'`)).rows[0].n);
        assert.ok(events >= 1 && toFollower.length === events, `one email per alert: ${toFollower.length} emails, ${events} alerts sent`);
        assert.match(toFollower[0].text, /Not investment advice\./);
        assert.match(toFollower[0].text, /Unsubscribe: https:\/\/bigstocks\.test\/unsubscribe\?token=/);
        await runWorker({ db, sec, sending: true, summaries: false, once: true, pressFetch });
        assert.equal(mail.filter((m) => m.to[0] === "follower@example.org").length, toFollower.length, "nothing is sent twice");
      });

      await test("with sending switched off, alerts are prepared but no email leaves", async () => {
        const cik = Number((await db.query(`select cik from public.alert_subscriptions where address = 'follower@example.org'`)).rows[0].cik);
        await db.query(`update public.filings set matched_at = null, accepted_at = now() where cik = $1`, [cik]);
        await db.query(`delete from public.alert_events`);
        mail.length = 0;
        console.log = (...a: unknown[]) => { if (/^\[email:console\]/.test(a.join(" "))) mail.push({ to: ["x"], subject: "", text: "" }); };
        await runWorker({ db, sec, sending: false, summaries: false, once: true, pressFetch });
        console.log = log;
        assert.equal(mail.length, 0);
        assert.ok(Number((await db.query(`select count(*) as n from public.alert_events where status = 'queued'`)).rows[0].n) >= 1);
      });
    } finally {
      console.log = log;
      console.error = realError;
      await db.end();
    }
  }, { ifAvailable: process.argv.includes("--if-available") });

  if (!ran) console.log("(skipped)");
  if (!finish("worker test")) process.exit(1);
}

main().catch((e) => {
  console.error("worker test could not run:", (e as Error).message);
  process.exit(1);
});
