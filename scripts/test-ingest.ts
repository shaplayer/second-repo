/**
 * Tests for the SEC ingestion modules: the rate-limited client, the parsers and the database writers.
 *
 *   npx tsx scripts/test-ingest.ts
 *
 * No network: every fetch is a fake passed in, and every SEC document is a file in lib/sec/fixtures/.
 * The database part creates one throwaway database (bs_ingest_*) on a LOCAL Postgres, runs the real
 * migrations in it and drops it at the end. With no local Postgres it is skipped with a notice.
 * TEST_PG_URL may point at a local server's maintenance database
 * (default: postgresql://<you>@localhost/postgres?host=/var/run/postgresql).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";
import { Client, type Pool, type PoolClient } from "pg";
import { migrate } from "../lib/db/migrate";
import { describeTarget } from "../lib/db/target";
import { classifyFilings } from "../lib/ingest/classify";
import { nextCompaniesToRefresh, refreshCompanyHealth, refreshCompanyProfile, type HealthDeps } from "../lib/ingest/company";
import type { Db } from "../lib/ingest/db";
import { MAX_BODY_CHARS, processFilingDetails } from "../lib/ingest/detail";
import { pollCurrentFilings } from "../lib/ingest/filings";
import { PRESS_FEEDS, PRESS_USER_AGENT, pollPressFeeds, resetPressBackoff } from "../lib/ingest/press";
import { extractTicker, parsePressRss } from "../lib/ingest/rss";
import { runJob, setJobDetail } from "../lib/ingest/state";
import { createSecClient, SecHttpError, SEC_PAUSE_MS, type SecClient } from "../lib/sec/client";
import { currentFeedUrl, newYorkDate, parseCurrentFeed } from "../lib/sec/current-feed";
import {
  documentsFromFolder,
  filingFolderUrl,
  filingIndexUrl,
  parseFilingIndexHtml,
  parseFolderJson,
  pickPressRelease,
  pickPrimary,
  rawXmlUrl,
} from "../lib/sec/filing-index";
import { insiderSummary, parseForm4, plainName, plainTitle, roundMoney, sharePrice } from "../lib/sec/form4";
import { companyAtomUrl, companyFactsUrl, newYorkClockToIso, parseCompanyAtom, parseSubmissions, submissionsUrl } from "../lib/sec/submissions";
import { htmlToText, releaseTitle } from "../lib/sec/text";
import { SecUserAgentError } from "../lib/sec/user-agent";
import { finish, test } from "./testing";

// Compile-time check: every kind of pg handle fits what the writers ask for.
export const anyHandle = (x: Client | Pool | PoolClient): Db => x;

const fx = (name: string) => readFileSync(`lib/sec/fixtures/${name}`, "utf8");
const UA = "Acme Research LLC sec-contact@acme-research.com";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

/* ---------- fakes ---------- */

type Call = { url: string; headers: Record<string, string>; at: number };
type Reply = Response | { status?: number; body?: string | Uint8Array; headers?: Record<string, string> } | Error;

/** A stand-in for fetch: answers from `reply`, records every call, never touches the network. */
function fakeFetch(reply: (url: string, n: number) => Reply | Promise<Reply>, clock: () => number = Date.now) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url, headers, at: clock() });
    await Promise.resolve();
    const r = await reply(url, calls.length);
    if (r instanceof Error) throw r;
    if (r instanceof Response) return r;
    return new Response((r.body ?? "") as BodyInit, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { fn, calls };
}

/** A clock that only moves when something sleeps, so rate-limit tests take no real time. */
function fakeClock(start = 1_800_000_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => void (t += ms),
    sleeps,
  };
}

/** A stand-in for the SEC client: answers from a table of URLs; anything else is a 404. */
function stubSec(routes: Record<string, string | (() => string)>) {
  const calls: string[] = [];
  let pausedUntil: number | null = null;
  const get = async (url: string) => {
    calls.push(url);
    if (pausedUntil !== null) throw new SecHttpError(403, url, "paused");
    const r = routes[url];
    if (r === undefined) throw new SecHttpError(404, url);
    return typeof r === "function" ? r() : r;
  };
  const client: SecClient = {
    text: get,
    json: async <T = unknown>(url: string) => JSON.parse(await get(url)) as T,
    stats: () => ({ requests: calls.length, retries: 0, pausedUntil }),
  };
  return { client, calls, routes, pause: (until: number | null) => void (pausedUntil = until) };
}

const fail = (status: number) => () => {
  throw new SecHttpError(status, "stub");
};

/** Runs fn with console.error and console.warn collected instead of printed. */
async function quietly<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const [error, warn] = [console.error, console.warn];
  console.error = console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

type FeedEntry = { form: string; name: string; cik: number; role: string; accession: string; updated: string; items?: string[]; folderCik?: number };
const pad10 = (n: number) => String(n).padStart(10, "0");
function feedXml(entries: FeedEntry[]): string {
  const one = (e: FeedEntry) => `<entry>
<title>${e.form} - ${e.name} (${pad10(e.cik)}) (${e.role})</title>
<link rel="alternate" type="text/html" href="${filingIndexUrl(e.folderCik ?? e.cik, e.accession)}"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; ${newYorkDate(e.updated)} &lt;b&gt;AccNo:&lt;/b&gt; ${e.accession} &lt;b&gt;Size:&lt;/b&gt; 9 KB${(e.items ?? []).map((i) => `&lt;br&gt;Item ${i}: Something`).join("")}</summary>
<updated>${e.updated}</updated>
<category scheme="https://www.sec.gov/" label="form type" term="${e.form}"/>
<id>urn:tag:sec.gov,2008:accession-number=${e.accession}</id>
</entry>`;
  return `<?xml version="1.0" encoding="ISO-8859-1" ?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n<title>Latest Filings</title>\n${entries.map(one).join("\n")}\n</feed>\n`;
}

/* ---------- the SEC client ---------- */

async function clientTests() {
  console.log("SEC client");

  await test("refuses http and every host that is not the SEC's, before any request", async () => {
    const f = fakeFetch(() => ({ body: "x" }));
    const c = createSecClient({ userAgent: UA, fetch: f.fn });
    for (const url of [
      "http://www.sec.gov/Archives/edgar/data/1/x.htm",
      "https://example.com/feed",
      "https://sec.gov/Archives/x",
      "https://www.sec.gov.evil.example/Archives/x",
      "https://efts.sec.gov/LATEST/search-index?q=x",
      "https://user:pw@www.sec.gov/Archives/x",
      "https://www.sec.gov:8443/Archives/x",
      "ftp://www.sec.gov/x",
      "not a url",
    ]) {
      await assert.rejects(c.text(url), /https|SEC address|valid URL/, url);
      await assert.rejects(c.json(url), /https|SEC address|valid URL/, url);
    }
    assert.equal(f.calls.length, 0);
    assert.equal(await c.text("https://www.sec.gov/Archives/ok.htm"), "x");
    assert.equal(await c.text("https://data.sec.gov/submissions/CIK0000320193.json"), "x");
    assert.equal(f.calls.length, 2);
  });

  await test("never starts more than 8 requests in any rolling second (50 callers at once)", async () => {
    for (const asked of [undefined, 100, 8]) {
      const clock = fakeClock();
      const f = fakeFetch(() => ({ body: "ok" }), clock.now);
      const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep, maxPerSecond: asked });
      const urls = Array.from({ length: 50 }, (_, i) => `https://www.sec.gov/Archives/edgar/data/1/${i}.htm`);
      const bodies = await Promise.all(urls.map((u, i) => (i % 2 ? c.text(u) : c.json<string>(u).catch(() => "ok"))));
      assert.equal(bodies.length, 50);
      assert.equal(f.calls.length, 50);
      assert.equal(new Set(f.calls.map((x) => x.url)).size, 50);
      const starts = f.calls.map((x) => x.at);
      for (const s of starts) {
        const inWindow = starts.filter((t) => t >= s && t < s + 1000).length;
        assert.ok(inWindow <= 8, `${inWindow} requests started within one second (maxPerSecond: ${asked})`);
      }
      // 50 requests at 8 a second cannot finish in under six seconds.
      assert.ok(starts[49] - starts[0] >= 6000, `50 requests took only ${starts[49] - starts[0]} ms`);
      assert.equal(c.stats().requests, 50);
    }
  });

  await test("a lower limit is respected too", async () => {
    const clock = fakeClock();
    const f = fakeFetch(() => ({ body: "ok" }), clock.now);
    const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep, maxPerSecond: 2 });
    await Promise.all(Array.from({ length: 9 }, (_, i) => c.text(`https://www.sec.gov/Archives/${i}`)));
    const starts = f.calls.map((x) => x.at);
    for (const s of starts) assert.ok(starts.filter((t) => t >= s && t < s + 1000).length <= 2);
  });

  await test("a 503 is retried and then succeeds; so is a network error", async () => {
    const clock = fakeClock();
    const f = fakeFetch((_, n) => (n === 1 ? { status: 503 } : n === 2 ? new TypeError("fetch failed") : { body: '{"ok":true}' }), clock.now);
    const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep });
    assert.deepEqual(await c.json("https://data.sec.gov/submissions/CIK0000000001.json"), { ok: true });
    assert.equal(f.calls.length, 3);
    assert.deepEqual(c.stats(), { requests: 3, retries: 2, pausedUntil: null });
    // Back-off: about half a second, then about a second.
    assert.ok(clock.sleeps[0] >= 500 && clock.sleeps[0] < 800, `first wait ${clock.sleeps[0]}`);
    assert.ok(clock.sleeps[1] >= 1000 && clock.sleeps[1] < 1300, `second wait ${clock.sleeps[1]}`);
  });

  await test("a server that keeps failing is given up on after 3 retries", async () => {
    const clock = fakeClock();
    const f = fakeFetch(() => ({ status: 502 }), clock.now);
    const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep });
    await assert.rejects(c.text("https://www.sec.gov/Archives/x"), (e: unknown) => e instanceof SecHttpError && e.status === 502 && e.url.endsWith("/x"));
    assert.equal(f.calls.length, 4);
    assert.equal(c.stats().retries, 3);
    assert.equal(c.stats().pausedUntil, null);
  });

  await test("a 403 stops every caller for 10 minutes and is not retried", async () => {
    const clock = fakeClock();
    const log: string[] = [];
    let blocked = true;
    const f = fakeFetch(() => (blocked ? { status: 403, body: "Undeclared Automated Tool" } : { body: "fine" }), clock.now);
    const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep, log: (l) => log.push(l) });
    const t0 = clock.now();
    await assert.rejects(c.text("https://www.sec.gov/Archives/a"), (e: unknown) => e instanceof SecHttpError && e.status === 403);
    assert.equal(f.calls.length, 1, "the 403 was not retried");
    assert.equal(c.stats().retries, 0);
    assert.equal(c.stats().pausedUntil, t0 + SEC_PAUSE_MS);
    assert.equal(SEC_PAUSE_MS, 600_000);
    // Every other caller is refused at once, without a request, on both hosts.
    const others = await Promise.allSettled([
      c.text("https://www.sec.gov/Archives/b"),
      c.json("https://data.sec.gov/submissions/CIK0000000002.json"),
      ...Array.from({ length: 30 }, (_, i) => c.text(`https://www.sec.gov/Archives/c${i}`)),
    ]);
    for (const o of others) {
      assert.equal(o.status, "rejected");
      const e = (o as PromiseRejectedResult).reason;
      assert.ok(e instanceof SecHttpError && e.status === 403 && /paused until/.test(e.message), String(e));
    }
    assert.equal(f.calls.length, 1, "nothing was sent during the pause");
    assert.deepEqual(clock.sleeps, [], "nobody waited or slept: they were refused immediately");
    assert.equal(log.length, 1, "one clear line");
    assert.match(log[0], /403/);
    assert.match(log[0], /stopped until/);
    // Still paused one second before the end; working again after it.
    clock.advance(SEC_PAUSE_MS - 1000);
    await assert.rejects(c.text("https://www.sec.gov/Archives/d"), SecHttpError);
    assert.equal(f.calls.length, 1);
    clock.advance(1001);
    blocked = false;
    assert.equal(c.stats().pausedUntil, null);
    assert.equal(await c.text("https://www.sec.gov/Archives/e"), "fine");
    assert.equal(f.calls.length, 2);
  });

  await test("callers already waiting when the 403 arrives are refused too", async () => {
    const clock = fakeClock();
    const f = fakeFetch(() => ({ status: 403 }), clock.now);
    const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep, log: () => {} });
    const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => c.text(`https://www.sec.gov/Archives/${i}`)));
    assert.ok(results.every((r) => r.status === "rejected" && r.reason instanceof SecHttpError));
    assert.ok(f.calls.length <= 8, `${f.calls.length} requests were sent; only the first second's worth may have started`);
  });

  await test("a 429 pauses too, for at least 10 minutes and for as long as Retry-After says", async () => {
    for (const [retryAfter, expected] of [[undefined, SEC_PAUSE_MS], ["30", SEC_PAUSE_MS], ["3600", 3_600_000]] as const) {
      const clock = fakeClock();
      const headers: Record<string, string> = retryAfter ? { "Retry-After": retryAfter } : {};
      const f = fakeFetch(() => ({ status: 429, headers }), clock.now);
      const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep, log: () => {} });
      const t0 = clock.now();
      await assert.rejects(c.text("https://www.sec.gov/Archives/a"), (e: unknown) => e instanceof SecHttpError && e.status === 429);
      assert.equal(f.calls.length, 1);
      assert.equal(c.stats().pausedUntil, t0 + expected);
    }
  });

  await test("a 404 is an error straight away: no retry, no pause", async () => {
    const clock = fakeClock();
    const f = fakeFetch(() => ({ status: 404 }), clock.now);
    const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep });
    await assert.rejects(c.json("https://data.sec.gov/api/xbrl/companyfacts/CIK0000000009.json"), (e: unknown) => {
      return e instanceof SecHttpError && e.status === 404 && e.url === "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000009.json";
    });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(c.stats(), { requests: 1, retries: 0, pausedUntil: null });
    assert.deepEqual(clock.sleeps, []);
  });

  await test("the declared User-Agent is on every request, retries included", async () => {
    const clock = fakeClock();
    const f = fakeFetch((_, n) => (n % 3 === 0 ? { status: 500 } : { body: "{}" }), clock.now);
    const c = createSecClient({ userAgent: `  ${UA} `, fetch: f.fn, now: clock.now, sleep: clock.sleep });
    for (let i = 0; i < 7; i++) await (i % 2 ? c.text(`https://www.sec.gov/Archives/${i}`) : c.json(`https://data.sec.gov/x/${i}.json`));
    assert.ok(f.calls.length > 7);
    for (const call of f.calls) {
      assert.equal(call.headers["user-agent"], UA);
      assert.equal(call.headers["accept-encoding"], "gzip, deflate");
      assert.ok(call.headers.accept);
    }
    assert.match(f.calls.find((x) => x.url.endsWith(".json"))!.headers.accept, /application\/json/);
  });

  await test("a missing or placeholder SEC_USER_AGENT fails when the client is created", () => {
    const saved = process.env.SEC_USER_AGENT;
    const f = fakeFetch(() => ({ body: "x" }));
    try {
      delete process.env.SEC_USER_AGENT;
      assert.throws(() => createSecClient({ fetch: f.fn }), (e: unknown) => e instanceof SecUserAgentError && /SEC_USER_AGENT is not set/.test(e.message));
      process.env.SEC_USER_AGENT = "BigStocks admin@yourdomain.com";
      assert.throws(() => createSecClient({ fetch: f.fn }), /placeholder/);
      process.env.SEC_USER_AGENT = UA;
      assert.doesNotThrow(() => createSecClient({ fetch: f.fn }));
      assert.throws(() => createSecClient({ userAgent: "", fetch: f.fn }), SecUserAgentError);
      assert.throws(() => createSecClient({ userAgent: "Mozilla/5.0", fetch: f.fn }), SecUserAgentError);
    } finally {
      if (saved === undefined) delete process.env.SEC_USER_AGENT;
      else process.env.SEC_USER_AGENT = saved;
    }
    assert.equal(f.calls.length, 0);
  });

  await test("redirects are followed only while they stay on the SEC's hosts", async () => {
    const clock = fakeClock();
    const f = fakeFetch((url) => {
      if (url.endsWith("/moved")) return { status: 301, headers: { Location: "/Archives/new-place" } };
      if (url.endsWith("/new-place")) return { body: "arrived" };
      return { status: 302, headers: { Location: "https://elsewhere.example/x" } };
    }, clock.now);
    const c = createSecClient({ userAgent: UA, fetch: f.fn, now: clock.now, sleep: clock.sleep });
    assert.equal(await c.text("https://www.sec.gov/Archives/moved"), "arrived");
    assert.deepEqual(f.calls.map((x) => x.url), ["https://www.sec.gov/Archives/moved", "https://www.sec.gov/Archives/new-place"]);
    assert.equal(f.calls[1].headers["user-agent"], UA);
    await assert.rejects(c.text("https://www.sec.gov/Archives/away"), (e: unknown) => e instanceof SecHttpError && e.status === 302 && /not an SEC address/.test(e.message));
    assert.ok(!f.calls.some((x) => x.url.includes("elsewhere")));
    assert.equal(f.calls.length, 3, "a redirect that leaves the SEC is not followed and not retried");
  });

  await test("feeds in ISO-8859-1 are decoded as such; a bad JSON body is an error", async () => {
    const latin1 = Uint8Array.from(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1" ?><t>Société Générale</t>', "latin1"));
    const f = fakeFetch((url) => (url.endsWith("atom") ? { body: latin1 } : url.endsWith("utf8") ? { body: "café ’" } : { body: "<html>" }));
    const c = createSecClient({ userAgent: UA, fetch: f.fn });
    assert.match(await c.text("https://www.sec.gov/cgi-bin/browse-edgar?output=atom"), /Société Générale/);
    assert.equal(await c.text("https://www.sec.gov/Archives/utf8"), "café ’");
    await assert.rejects(c.json("https://data.sec.gov/x.json"), /not JSON/);
  });
}

/* ---------- parsers ---------- */

async function parserTests() {
  console.log("parsers");

  await test("latest-filings feed: accession, company number, exact time, sections, roles", () => {
    assert.equal(currentFeedUrl(), "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&start=0&count=100&output=atom");
    assert.match(currentFeedUrl(200, 100), /&start=200&count=100&/);
    const entries = parseCurrentFeed(fx("current-feed.xml"));
    assert.equal(entries.length, 14, "15 entries in the file, one of them unreadable");
    assert.deepEqual(entries[0], {
      accession: "0009000001-26-000041",
      cik: 9000001,
      companyName: "NORTHWIND BIOTHERAPEUTICS, INC.",
      form: "8-K",
      role: "filer",
      acceptedAt: "2026-11-04T22:38:02.000Z",
      filedDate: "2026-11-04",
      items: ["8.01", "9.01"],
      indexUrl: `${ARCHIVES}/9000001/000900000126000041/0009000001-26-000041-index.htm`,
    });
    assert.equal(entries[1].role, "subject");
    assert.equal(entries[1].accession, entries[0].accession);
    assert.deepEqual(entries[2].items, ["2.02", "9.01"]);
    assert.equal(entries[2].acceptedAt, "2026-11-04T22:21:40.000Z");
    // An entry with no filing date and no accession number in its summary: both come from elsewhere.
    const fund = entries.find((e) => e.cik === 9999999)!;
    assert.equal(fund.accession, "0009999999-26-000001");
    assert.equal(fund.filedDate, "2026-11-04");
    assert.deepEqual(fund.items, ["3.02"]);
    // An insider trade is listed once for the person and once for the company.
    const trade = entries.filter((e) => e.accession === "0009100001-26-000004");
    assert.deepEqual(trade.map((e) => [e.role, e.cik, e.companyName, e.form]), [
      ["reporting", 9100001, "MARSH ELENA R", "4"],
      ["issuer", 9000002, "Halcyon Grid Systems Corp", "4"],
    ]);
    assert.equal(trade[1].indexUrl, `${ARCHIVES}/9000002/000910000126000004/0009100001-26-000004-index.htm`);
    const stake = entries.filter((e) => e.accession === "0009200001-26-000009");
    assert.deepEqual(stake.map((e) => [e.role, e.cik, e.form]), [["filed-by", 9200001, "SCHEDULE 13D"], ["subject", 9000003, "SCHEDULE 13D"]]);
    // Brackets, a dash and an ampersand in a company's name; a link written without the host.
    const kestrel = entries.find((e) => e.cik === 9000006)!;
    assert.equal(kestrel.companyName, "Kestrel & Finch (Holdings) Inc. - Class A");
    assert.equal(kestrel.form, "424B4");
    assert.equal(kestrel.indexUrl, `${ARCHIVES}/9000006/000900000626000005/0009000006-26-000005-index.htm`);
    // Accepted just before midnight in New York: the filing date is New York's, not London's.
    const late = entries.find((e) => e.form === "8-K/A")!;
    assert.equal(late.acceptedAt, "2026-11-04T04:58:10.000Z");
    assert.equal(late.filedDate, "2026-11-03");
    assert.deepEqual(late.items, ["5.02"]);
    assert.ok(entries.every((e) => e.indexUrl.startsWith("https://www.sec.gov/Archives/")));
  });

  await test("latest-filings feed: rubbish never throws", () => {
    assert.deepEqual(parseCurrentFeed(""), []);
    assert.deepEqual(parseCurrentFeed("<html><body>Request Rate Threshold Exceeded</body></html>"), []);
    assert.deepEqual(parseCurrentFeed("<feed><entry><title>8-K - X (1) (Filer)</title></entry><entry>"), []);
    const half = fx("current-feed.xml").slice(0, 1500);
    assert.equal(parseCurrentFeed(half).length, 2, "a feed cut off mid-entry still gives the whole entries");
  });

  await test("filing index: a company-news filing with a press release and pictures", () => {
    const docs = parseFilingIndexHtml(fx("index-8k-release.htm"));
    assert.deepEqual(docs.map((d) => [d.sequence, d.type, d.name]), [
      [1, "8-K", "hgrd-20261104.htm"],
      [2, "EX-99.1", "hgrd-ex991_q32026.htm"],
      [3, "EX-99.2", "hgrd-ex992_slides.htm"],
      [4, "GRAPHIC", "hgrd-logo.jpg"],
      [5, "GRAPHIC", "chart_001.jpg"],
      [null, "", "0009000002-26-000107.txt"],
    ]);
    // The "/ix?doc=" viewer prefix is gone, and the XBRL "Data Files" table is left out.
    assert.equal(docs[0].url, `${ARCHIVES}/9000002/000900000226000107/hgrd-20261104.htm`);
    assert.ok(docs.every((d) => d.url.startsWith("https://www.sec.gov/Archives/") && !d.url.includes("ix?doc")));
    assert.ok(!docs.some((d) => d.name.endsWith(".xsd") || d.type === "XML"));
    assert.equal(pickPrimary(docs, "8-K")!.name, "hgrd-20261104.htm");
    assert.equal(pickPrimary(docs, "8-K/A")!.name, "hgrd-20261104.htm");
    assert.equal(pickPressRelease(docs)!.url, `${ARCHIVES}/9000002/000900000226000107/hgrd-ex991_q32026.htm`);
    assert.equal(docs[1].description, "EX-99.1");
  });

  await test("filing index: no exhibits, capitals and single quotes in the markup", () => {
    const docs = parseFilingIndexHtml(fx("index-8k-plain.htm"));
    assert.deepEqual(docs.map((d) => [d.sequence, d.type, d.name]), [
      [1, "8-K", "bwpy_8k.htm"],
      [2, "EX-10.1", "bwpy_ex101.htm"],
      [null, "", "0009000005-26-000088.txt"],
    ]);
    assert.equal(pickPrimary(docs, "8-K")!.url, `${ARCHIVES}/9000005/000900000526000088/bwpy_8k.htm`);
    assert.equal(pickPressRelease(docs), null);
  });

  await test("filing index: a quarterly report shown through the inline viewer", () => {
    const docs = parseFilingIndexHtml(fx("index-10q.htm"));
    assert.equal(docs.length, 4);
    const main = pickPrimary(docs, "10-Q")!;
    assert.equal(main.url, `${ARCHIVES}/9000003/000900000326000012/cplm-20260930.htm`);
    assert.equal(main.type, "10-Q");
    assert.equal(pickPressRelease(docs), null);
  });

  await test("filing index: an insider trade's drawn page and its raw data file", () => {
    const docs = parseFilingIndexHtml(fx("index-form4.htm"));
    assert.deepEqual(docs.map((d) => d.name), ["xslF345X05/wk-form4_1730412345.xml", "wk-form4_1730412345.xml", "0009100001-26-000004.txt"]);
    const main = pickPrimary(docs, "4")!;
    assert.equal(main.url, `${ARCHIVES}/9000002/000910000126000004/xslF345X05/wk-form4_1730412345.xml`);
    assert.equal(rawXmlUrl(main), `${ARCHIVES}/9000002/000910000126000004/wk-form4_1730412345.xml`);
    assert.equal(rawXmlUrl(docs[1]), docs[1].url, "a raw file's address is left alone");
    assert.equal(rawXmlUrl({ url: `${ARCHIVES}/1/000000000126000001/xslF345X06/form4.xml` }), `${ARCHIVES}/1/000000000126000001/form4.xml`);
  });

  await test("press release choice: EX-99.1 first, then EX-99, EX-99.01, EX-99.2; readable files only", () => {
    const doc = (type: string, name: string) => ({ sequence: null, description: "", type, name, url: `${ARCHIVES}/1/000000000126000001/${name}` });
    const pick = (...d: ReturnType<typeof doc>[]) => pickPressRelease(d)?.name ?? null;
    assert.equal(pick(doc("EX-99.2", "b.htm"), doc("EX-99.1", "a.htm"), doc("EX-99", "c.htm")), "a.htm");
    assert.equal(pick(doc("EX-99.2", "b.htm"), doc("EX-99.01", "d.htm"), doc("EX-99", "c.htm")), "c.htm");
    assert.equal(pick(doc("EX-99.2", "b.htm"), doc("EX-99.01", "d.html")), "d.html");
    assert.equal(pick(doc("EX-99.3", "e.txt"), doc("EX-99.2", "b.htm")), "b.htm");
    assert.equal(pick(doc("EX-99.1", "a.pdf"), doc("EX-99.2", "b.htm")), "b.htm", "a PDF cannot be read as text");
    assert.equal(pick(doc("EX-99.1", "a.jpg")), null);
    assert.equal(pick(doc("EX-10.1", "x.htm"), doc("8-K", "y.htm"), doc("EX-101.SCH", "z.xsd")), null);
  });

  await test("folder listing: files, and the name-based guess used when the index page cannot be read", () => {
    const folder = filingFolderUrl(9000002, "0009000002-26-000107");
    assert.equal(folder, `${ARCHIVES}/9000002/000900000226000107/`);
    assert.equal(filingIndexUrl(9000002, "0009000002-26-000107"), `${folder}0009000002-26-000107-index.htm`);
    const files = parseFolderJson(JSON.parse(fx("folder-index.json")), folder);
    assert.equal(files.length, 10);
    assert.ok(files.every((f) => f.url === folder + f.name));
    assert.deepEqual(parseFolderJson({}, folder), []);
    assert.deepEqual(parseFolderJson({ directory: { item: [{ name: "../../etc/passwd" }, { name: "sub" }, { name: "ok.htm" }] } }, folder.slice(0, -1)), [
      { name: "ok.htm", url: folder + "ok.htm" },
    ]);
    const docs = documentsFromFolder(files, "8-K");
    assert.equal(pickPrimary(docs, "8-K")!.name, "hgrd-20261104.htm");
    assert.equal(pickPressRelease(docs)!.name, "hgrd-ex991_q32026.htm");
    const trade = documentsFromFolder([{ name: "0009100001-26-000004-index.html", url: "x" }, { name: "wk-form4_1.xml", url: `${folder}wk-form4_1.xml` }], "4");
    assert.equal(pickPrimary(trade, "4")!.name, "wk-form4_1.xml");
  });

  await test("htmlToText: a realistic press-release exhibit", () => {
    const text = htmlToText(fx("ex99-1-release.htm"));
    const lines = text.split("\n");
    assert.deepEqual(lines.slice(0, 5), [
      "Exhibit 99.1",
      "FOR IMMEDIATE RELEASE",
      "HALCYON GRID SYSTEMS CORP",
      "Halcyon Grid Systems Reports Record Third Quarter 2026 Revenue of $48.2 Million, Up 61% Year-Over-Year",
      "Raises full-year outlook; backlog grows to $310 million",
    ]);
    assert.match(lines[5], /^AUSTIN, Texas, Nov\. 4, 2026 \/PRNewswire\/ -- Halcyon Grid Systems Corp \(NYSE: HGRD\) \(“Halcyon” or the “Company”\)/);
    assert.match(text, /a year earlier — the Company’s highest quarterly revenue to date\./);
    assert.match(text, /“Demand from utilities & data-center developers hasn’t slowed\.”/, "&amp; and the Windows apostrophe &#146;");
    assert.match(text, /• Revenue of \$48\.2 million, up 61%\n• Gross margin of 27\.4%, up from 21\.0%\n• Net loss/);
    assert.ok(!/this must not appear|font-family|EX-99\.1|Document created|<|&nbsp;|&#/.test(text), "no script, style, title, comment, tag or entity left");
    assert.ok(!/ {2}| |\n\n/.test(text), "white space is collapsed");
  });

  await test("htmlToText: hidden inline-XBRL block, entities, odd input", () => {
    assert.equal(
      htmlToText("<html><body><ix:header><ix:hidden>0000320193 --09-26</ix:hidden></ix:header><div>Net sales&#160;were <b>&#36;94.9</b>&nbsp;billion &ndash; up 6%</div><p>O&rsquo;Brien &#x201C;said&#x201D; &lsquo;yes&rsquo;&hellip;</p></body></html>"),
      "Net sales were $94.9 billion – up 6%\nO’Brien “said” ‘yes’…",
    );
    assert.equal(htmlToText("AT&amp;T &lt;T&gt; &unknown; &#0; &#99999999;"), "AT&T <T> &unknown;");
    assert.equal(htmlToText(""), "");
    assert.equal(htmlToText(undefined as unknown as string), "");
    assert.equal(htmlToText("plain\r\n\r\n  text  "), "plain\ntext");
  });

  await test("releaseTitle: finds the headline, passes over letterhead, datelines and contacts", () => {
    const text = htmlToText(fx("ex99-1-release.htm"));
    assert.equal(
      releaseTitle(text, "Halcyon Grid Systems Corp"),
      "Halcyon Grid Systems Reports Record Third Quarter 2026 Revenue of $48.2 Million, Up 61% Year-Over-Year",
    );
    assert.equal(
      releaseTitle("Exhibit 99.1\nApple Inc.\nNEWS RELEASE\nCUPERTINO, Calif., Nov. 4, 2026\nContact: Jane Doe, (408) 555-0100\npress@apple.com\nApple reports fourth quarter results\nCUPERTINO, Calif. -- Apple today announced...", "Apple Inc."),
      "Apple reports fourth quarter results",
    );
    assert.equal(releaseTitle("EX-99.1\nFOR IMMEDIATE RELEASE\nNovember 4, 2026\nNORTHWIND BIOTHERAPEUTICS, INC.\nNORTHWIND ANNOUNCES POSITIVE PHASE 2 RESULTS\nMore text", "Northwind Biotherapeutics, Inc."), "NORTHWIND ANNOUNCES POSITIVE PHASE 2 RESULTS");
    // Nothing that reads like a headline before the body starts.
    assert.equal(releaseTitle("Exhibit 99.1\nFOR IMMEDIATE RELEASE\nACME CORP\nInvestor Relations: ir@acme.test", "Acme Corp"), null);
    assert.equal(
      releaseTitle(`Exhibit 99.1\nBOSTON, Nov. 04, 2026 (GLOBE NEWSWIRE) -- Northwind Biotherapeutics, Inc. (NASDAQ: NWBT), a clinical-stage company, today announced ${"results ".repeat(30)}\nA later line that looks like a headline`, "Northwind"),
      null,
    );
    assert.equal(releaseTitle("", "X"), null);
    assert.equal(releaseTitle("SHORT\nTOO SHORT\n12345 67890 12345 67890", "X"), null);
    assert.equal(releaseTitle("x".repeat(201) + "\nA headline that follows a very long line", "X"), "A headline that follows a very long line");
  });

  await test("insider trade: an open-market buy", () => {
    const f = parseForm4(fx("form4-buy.xml"));
    assert.equal(f.issuerCik, 9000002);
    assert.equal(f.issuerName, "Halcyon Grid Systems Corp");
    assert.deepEqual(f.trades, [
      { owner: "Elena R Marsh", role: "Chief Financial Officer", action: "bought", shares: 25000, price: 27.4, date: "2026-11-03" },
      { owner: "Elena R Marsh", role: "Chief Financial Officer", action: "bought", shares: 15000, price: 27.6667, date: "2026-11-04" },
    ]);
    assert.deepEqual(insiderSummary(f.trades), {
      headline: "Chief Financial Officer bought 40,000 shares",
      oneSentence: "The Chief Financial Officer bought about $1.1 million of stock on the open market.",
      bullets: [
        "Who: Elena R Marsh (Chief Financial Officer).",
        "Bought 40,000 shares at about $27.50 a share, about $1.1 million in total.",
        "This was an open-market trade, made at the market price.",
      ],
      whyItMatters: "Insiders buying with their own money is often read as a sign of confidence in the company.",
      tone: "Good news",
      importance: "High",
    });
  });

  await test("insider trade: a sale", () => {
    const f = parseForm4(fx("form4-sale.xml"));
    assert.equal(f.issuerCik, 320193);
    assert.deepEqual(f.trades.map((t) => [t.owner, t.role, t.action, t.shares, t.price, t.date]), [
      ["Timothy D Cook", "Director, Chief Executive Officer", "sold", 30000, 251.1, "2026-11-02"],
      ["Timothy D Cook", "Director, Chief Executive Officer", "sold", 20000, 252.35, "2026-11-02"],
    ]);
    assert.deepEqual(insiderSummary(f.trades), {
      headline: "Chief Executive Officer sold 50,000 shares",
      oneSentence: "The Chief Executive Officer sold about $12.6 million of stock on the open market.",
      bullets: [
        "Who: Timothy D Cook (Director, Chief Executive Officer).",
        "Sold 50,000 shares at about $251.60 a share, about $12.6 million in total.",
        "This was an open-market trade, made at the market price.",
      ],
      whyItMatters: "Insiders sell for many reasons, such as taxes or planned sales, so one sale is not a warning sign by itself.",
      tone: "Routine",
      importance: "Medium",
    });
  });

  await test("insider trade: an award (not an open-market trade)", () => {
    const f = parseForm4(fx("form4-award.xml"));
    assert.deepEqual(f.trades, [{ owner: "John P O'Brien Jr", role: "Director", action: "received", shares: 12500, price: null, date: "2026-10-15" }]);
    assert.deepEqual(insiderSummary(f.trades), {
      headline: "Director received 12,500 shares",
      oneSentence: "A director received 12,500 shares through an award or an option exercise, not an open-market trade.",
      bullets: [
        "Who: John P O'Brien Jr (Director).",
        "Received 12,500 shares.",
        "This was not an open-market trade: it came from a stock award, an option exercise, a gift or a similar transfer.",
      ],
      whyItMatters: "This is routine paperwork about an insider's stock awards.",
      tone: "Routine",
      importance: "Low",
    });
  });

  await test("insider trade: several people reporting together", () => {
    const f = parseForm4(fx("form4-multi-owner.xml"));
    assert.deepEqual(f.trades, [{ owner: "Ridgeback Capital LP and others", role: "10% owner", action: "bought", shares: 600000, price: 0.85, date: "2026-11-03" }]);
    assert.deepEqual(insiderSummary(f.trades), {
      headline: "Major shareholder bought 600,000 shares",
      oneSentence: "A major shareholder bought about $510,000 of stock on the open market.",
      bullets: [
        "Who: Ridgeback Capital LP and others (10% owner).",
        "Bought 600,000 shares at about $0.85 a share, about $510,000 in total.",
        "This was an open-market trade, made at the market price.",
      ],
      whyItMatters: "Insiders buying with their own money is often read as a sign of confidence in the company.",
      tone: "Good news",
      importance: "Medium",
    });
  });

  await test("insider trade: only options or awards changed (no share trades listed)", () => {
    const f = parseForm4(fx("form4-awards-only.xml"));
    assert.deepEqual(f.trades, []);
    assert.equal(f.owner, "Aiko Nakamura");
    assert.equal(f.role, "Senior Vice President & General Counsel");
    assert.equal(f.hasAwardChanges, true);
    assert.deepEqual(insiderSummary(f.trades, f), {
      headline: "An executive reported a change in their stock awards",
      oneSentence: "The Senior Vice President & General Counsel reported a change in their stock awards; no shares were bought or sold on the open market.",
      bullets: ["Who: Aiko Nakamura (Senior Vice President & General Counsel).", "No shares were bought or sold on the open market."],
      whyItMatters: "This is routine paperwork about an insider's stock awards.",
      tone: "Routine",
      importance: "Low",
    });
    assert.equal(insiderSummary([]).headline, "An insider reported a change in their stock awards");
    assert.deepEqual(insiderSummary([]).bullets, ["Who: a company insider.", "No shares were bought or sold on the open market."]);
  });

  await test("insider trade: mixed filings, wording rules and odd input", () => {
    const t = (action: "bought" | "sold" | "received" | "gave up", shares: number, price: number | null) => ({ owner: "Jane Doe", role: "Director", action, shares, price, date: null });
    const mixed = insiderSummary([t("received", 10000, null), t("gave up", 4200, 31.5), t("sold", 2000, 31.9)]);
    assert.equal(mixed.headline, "Director sold 2,000 shares");
    assert.deepEqual(mixed.bullets, [
      "Who: Jane Doe (Director).",
      "Sold 2,000 shares at about $31.90 a share, about $64,000 in total.",
      "Received 10,000 shares.",
      "Part was an open-market trade; the rest came from stock awards, option exercises or similar transfers.",
    ]);
    const both = insiderSummary([t("bought", 1000, 10), t("sold", 500, 12)]);
    assert.equal(both.headline, "Director bought and sold shares");
    assert.equal(both.tone, "Mixed");
    assert.equal(insiderSummary([t("bought", 100, null)]).oneSentence, "A director bought 100 shares on the open market.");
    assert.equal(insiderSummary([t("gave up", 4200, 31.5)]).headline, "Director gave up 4,200 shares");
    // Every summary: at most 12 words in the headline, 2 to 4 bullets, and no advice.
    const samples = [mixed, both, ...["form4-buy.xml", "form4-sale.xml", "form4-award.xml", "form4-multi-owner.xml", "form4-awards-only.xml"].map((n) => {
      const f = parseForm4(fx(n));
      return insiderSummary(f.trades, f);
    })];
    for (const s of samples) {
      assert.ok(s.headline.split(/\s+/).length <= 12, s.headline);
      assert.ok(s.bullets.length >= 2 && s.bullets.length <= 4, String(s.bullets.length));
      const all = [s.headline, s.oneSentence, s.whyItMatters, ...s.bullets].join(" ");
      assert.ok(!/\b(?:Buy|Sell)\b|\bshould\b|\brecommend|\bprice target\b/.test(all), all);
    }
    assert.deepEqual(parseForm4("not xml at all"), { issuerCik: null, issuerName: null, trades: [], owner: null, role: null, hasAwardChanges: false });
    assert.equal(plainName("COOK TIMOTHY D"), "Timothy D Cook");
    assert.equal(plainName("Musk Elon"), "Elon Musk");
    assert.equal(plainName("MCDONALD SARAH"), "Sarah McDonald");
    assert.equal(plainName("VANGUARD GROUP INC"), "Vanguard Group Inc");
    assert.equal(plainName("Berkshire Hathaway Inc"), "Berkshire Hathaway Inc");
    assert.equal(plainName("AT&amp;T PENSION TRUST"), "At&t Pension Trust");
    assert.equal(plainTitle("EVP & CFO"), "Executive Vice President & Chief Financial Officer");
    assert.equal(plainTitle("PRESIDENT AND CEO"), "President and Chief Executive Officer");
    assert.equal(plainTitle("Sr. VP, Sales"), "Senior Vice President, Sales");
    assert.equal(plainTitle("SVP, CHRO"), "Senior Vice President, CHRO");
    assert.deepEqual([1_100_300, 999_600, 849_600, 63_800, 4_321, 950.4, 2_400_000_000].map(roundMoney), ["$1.1 million", "$1 million", "$850,000", "$64,000", "$4,300", "$950", "$2.4 billion"]);
    assert.deepEqual([27.5, 251.6, 0.85, 0.0125, 1234.5].map(sharePrice), ["$27.50", "$251.60", "$0.85", "$0.0125", "$1,234.50"]);
  });

  await test("company record: a large company that is not an emerging growth company (Apple, real sample)", () => {
    assert.equal(submissionsUrl(320193), "https://data.sec.gov/submissions/CIK0000320193.json");
    assert.equal(companyFactsUrl(320193), "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json");
    assert.equal(companyAtomUrl(320193), "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=&dateb=&owner=include&count=100&output=atom");
    const s = parseSubmissions(JSON.parse(fx("submissions-320193.json")));
    assert.deepEqual(s.company, {
      name: "Apple Inc.",
      sic: "3571",
      sicDescription: "Electronic Computers",
      website: null,
      phone: "(408) 996-1010",
      fiscalYearEnd: "0926",
      city: "Cupertino",
      state: "CA",
      filerCategory: "Large accelerated filer",
      isEmergingGrowth: false,
      tickers: ["AAPL"],
      exchanges: ["Nasdaq"],
    });
    assert.equal(s.reportsAsInsider, false);
    assert.equal(s.recent.length, 120);
    assert.deepEqual(s.recent[1], {
      accession: "0001140361-26-042798",
      form: "8-K",
      filedDate: "2026-11-09",
      acceptance: "2026-11-09T21:30:40.000Z",
      items: ["8.01", "9.01"],
      primaryDocument: "ef20085077_8k.htm",
    });
    assert.deepEqual(s.recent[4].items, []);
    assert.equal(s.recent[4].primaryDocument, "xslF345X06/form4.xml");
  });

  await test("company record: an emerging growth company (Venyra, real sample)", () => {
    const s = parseSubmissions(JSON.parse(fx("submissions-2074652.json")));
    assert.equal(s.company.name, "Venyra Corp");
    assert.equal(s.company.isEmergingGrowth, true);
    assert.equal(s.company.filerCategory, "Non-accelerated filer | Smaller reporting company | Emerging growth company");
    assert.equal(s.company.fiscalYearEnd, "0430");
    assert.equal(s.company.city, "Valencia");
    assert.equal(s.company.state, "Spain", "a company outside the US has a country where the state would be");
    assert.deepEqual([s.company.tickers, s.company.exchanges], [["VNYR"], ["OTC"]]);
    assert.equal(s.recent.length, 15);
    assert.deepEqual(s.recent.find((f) => f.form === "EFFECT")!.items, [], 'an items field of ",," is no items');
    assert.throws(() => parseSubmissions({}), /Not an SEC company record/);
    assert.throws(() => parseSubmissions(null), /Not an SEC company record/);
    const bare = parseSubmissions({ name: "Bare Co", category: "<br>Emerging Growth Company", website: "www.bare.test", addresses: { business: { city: "ST. LOUIS", stateOrCountry: "MO" } } });
    assert.equal(bare.company.isEmergingGrowth, true);
    assert.equal(bare.company.filerCategory, "Emerging Growth Company");
    assert.equal(bare.company.website, "https://www.bare.test");
    assert.equal(bare.company.city, "St. Louis");
    assert.deepEqual(bare.recent, []);
  });

  await test("company feed: exact acceptance times by accession number; New York clock times", () => {
    const times = parseCompanyAtom(fx("company-atom-320193.xml"));
    assert.deepEqual([...times], [
      ["0001140361-26-042798", "2026-11-09T21:30:40.000Z"],
      ["0000320193-26-000026", "2026-11-03T23:05:15.000Z"],
      ["0000320193-26-000024", "2026-11-02T21:30:23.000Z"],
    ]);
    assert.equal(parseCompanyAtom("nothing here").size, 0);
    assert.equal(newYorkClockToIso("2026-11-04", 16), "2026-11-04T21:00:00.000Z", "winter: five hours behind");
    assert.equal(newYorkClockToIso("2026-07-06", 16), "2026-07-06T20:00:00.000Z", "summer: four hours behind");
    assert.equal(newYorkDate("2026-11-04T04:58:10.000Z"), "2026-11-03");
  });

  await test("newswire feed: tickers, and markets outside the US kept apart", () => {
    const items = parsePressRss(fx("press-rss.xml"));
    assert.deepEqual(items.map((i) => i.ticker), ["NWBT", "HGRD", "CPLMF", "BWPY", "VORB", "SLVP"], "the item that names no ticker is left out");
    assert.equal(items[0].title, "Northwind Biotherapeutics Announces Positive Topline Phase 2 Results for NW-210 in Rare Liver Disease");
    assert.equal(items[0].publishedAt, "2026-11-04T22:41:00.000Z");
    assert.equal(items[0].company, "Northwind Biotherapeutics, Inc.");
    assert.ok(items.every((i) => i.usListed && i.url.startsWith("https://")));
    assert.equal(extractTicker("Northwind Biotherapeutics, Inc. (NASDAQ: NWBT), a clinical-stage company"), "NWBT");
    assert.equal(extractTicker("Berkshire Hathaway (NYSE: BRK.B) said"), "BRK.B");
    assert.equal(extractTicker("Northwind (Nasdaq:NWBT) today"), "NWBT");
    assert.equal(extractTicker("Acme (NYSE Arca: ACMX) today"), "ACMX");
    assert.equal(extractTicker("Foo Corp. (Nasdaq Capital Market: FOOX)"), "FOOX");
    assert.equal(extractTicker("Maple Gold (TSX: MPL) (NYSE American: MPLG)"), "MPLG", "the US listing wins");
    assert.equal(extractTicker("no ticker here: ABC"), null);
    const odd = parsePressRss(`<rss><channel>
      <item><title>Maple Gold (TSXV: HGRD) drills</title><link>https://wire.test/a</link><pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Insecure link (NYSE: HGRD)</title><link>http://wire.test/b</link><pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title></title><link>https://wire.test/c</link><description>(NYSE: HGRD)</description><pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>No time (NYSE: HGRD)</title><link>https://wire.test/d</link></item>
    </channel></rss>`);
    assert.deepEqual(odd.map((i) => [i.url, i.ticker, i.usListed]), [["https://wire.test/a", "HGRD", false]]);
    assert.deepEqual(parsePressRss("<html>403 Forbidden</html>"), []);
    assert.deepEqual(parsePressRss(""), []);
  });
}

/* ---------- database writers ---------- */

const ADMIN_URL =
  process.env.TEST_PG_URL ??
  `postgresql://${encodeURIComponent(process.env.PGUSER ?? os.userInfo().username)}@localhost/postgres?host=/var/run/postgresql`;

const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = "/" + name;
  return u.toString();
};

const HALCYON_8K = "0009000002-26-000107";
const BRIGHTWATER_8K = "0009000005-26-000088";
const BRIGHTWATER_8KA = "0009000005-26-000089";
const NORTHWIND_8K = "0009000001-26-000041";
const FUND_8K = "0009999999-26-000001";
const HALCYON_TRADE = "0009100001-26-000004";
const RELEASE_TITLE = "Halcyon Grid Systems Reports Record Third Quarter 2026 Revenue of $48.2 Million, Up 61% Year-Over-Year";

async function databaseTests(c: Client) {
  const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[];
  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
  const num = async (sql: string, params: unknown[] = []) => Number(Object.values((await one(sql, params)) ?? { n: NaN })[0]);
  const filing = (accession: string) =>
    one<{
      cik: string; form: string; items: string[]; category: string | null; accepted_at: Date; filed_date: string; primary_url: string;
      index_url: string; title: string | null; primary_document: string | null; detail_checked_at: Date | null; detail_error: string | null;
      matched_at: Date | null;
    }>(`select cik, form, items, category, accepted_at, filed_date::text, primary_url, index_url, title, primary_document, detail_checked_at, detail_error, matched_at from public.filings where accession = $1`, [accession]);

  await c.query(
    `insert into public.companies (cik, ticker, name, exchange, tracked) values
       (9000001, 'NWBT',  'NORTHWIND BIOTHERAPEUTICS, INC.', 'Nasdaq', false),
       (9000002, 'HGRD',  'Halcyon Grid Systems Corp',       'NYSE',   false),
       (9000003, 'CPLMF', 'Copperline Minerals Ltd',         'OTC',    false),
       (9000005, 'BWPY',  'Brightwater Payments, Inc.',      'Nasdaq', false),
       (9000006, 'KSFN',  'Kestrel & Finch (Holdings) Inc.', 'NYSE',   false),
       (320193,  'AAPL',  'Apple Inc. (as first loaded)',    'Nasdaq', true),
       (2074652, 'VNYR',  'Venyra Corp',                     'OTC',    true),
       (2084272, null,    'Unity Forge Inc',                 null,     true)`,
  );
  await c.query(
    `insert into public.company_tickers (ticker, cik, exchange, is_primary) values
       ('NWBT', 9000001, 'Nasdaq', true), ('HGRD', 9000002, 'NYSE', true), ('CPLMF', 9000003, 'OTC', true),
       ('BWPY', 9000005, 'Nasdaq', true), ('KSFN', 9000006, 'NYSE', true), ('AAPL', 320193, 'Nasdaq', true), ('VNYR', 2074652, 'OTC', true)`,
  );

  console.log("database: job state");

  await test("runJob records a success, then a failure, and never throws", async () => {
    assert.equal(await runJob(c, "test.job", async () => 41 + 1), 42);
    const ok = (await one<{ last_run_at: Date; last_success_at: Date; last_error: string | null }>(`select * from public.job_state where job = 'test.job'`))!;
    assert.ok(ok.last_run_at && ok.last_success_at);
    assert.equal(ok.last_error, null);
    const { result, lines } = await quietly(() => runJob(c, "test.job", async () => { throw new Error("the SEC\n was unreachable"); }));
    assert.equal(result, null);
    assert.equal(lines.length, 1, "one log line");
    assert.match(lines[0], /\[job test\.job\] failed: the SEC was unreachable/);
    const bad = (await one<{ last_run_at: Date; last_success_at: Date; last_error: string; last_error_at: Date }>(`select * from public.job_state where job = 'test.job'`))!;
    assert.equal(bad.last_error, "the SEC was unreachable");
    assert.ok(bad.last_error_at);
    assert.equal(bad.last_success_at.getTime(), ok.last_success_at.getTime(), "the last success is kept");
    assert.ok(bad.last_run_at >= ok.last_run_at);
    assert.equal(await num(`select count(*) from public.job_state`), 1);
    // A job name the table refuses: still no throw, the job itself still runs.
    const odd = await quietly(() => runJob(c, "Not A Valid Name", async () => "ran"));
    assert.equal(odd.result, "ran");
    // A database that is gone: still no throw.
    const dead = { query: async () => { throw new Error("connection lost"); } } as unknown as Db;
    assert.equal((await quietly(() => runJob(dead, "test.job", async () => "ran anyway"))).result, "ran anyway");
  });

  await test("setJobDetail stores and replaces the job's small record", async () => {
    await setJobDetail(c, "test.job", { newest: "0000000001-26-000001", pages: 2 });
    await setJobDetail(c, "test.job", { pages: 3 });
    await setJobDetail(c, "other.job", { a: 1 });
    assert.deepEqual((await one<{ detail: object }>(`select detail from public.job_state where job = 'test.job'`))!.detail, { pages: 3 });
    assert.deepEqual((await one<{ detail: object }>(`select detail from public.job_state where job = 'other.job'`))!.detail, { a: 1 });
    assert.ok((await one<{ last_success_at: Date }>(`select last_success_at from public.job_state where job = 'test.job'`))!.last_success_at);
  });

  console.log("database: latest filings");

  await test("pollCurrentFilings stores new filings once, through the real client", async () => {
    const f = fakeFetch((url) => (url === currentFeedUrl(0, 100) ? { body: fx("current-feed.xml") } : { status: 404 }));
    const sec = createSecClient({ userAgent: UA, fetch: f.fn });
    const first = await pollCurrentFilings(c, sec, { now: new Date("2026-11-04T23:00:00Z") });
    assert.equal(first.fetchedPages, 1, "a short page is the last page");
    assert.deepEqual([...first.newFilings].sort(), [
      NORTHWIND_8K, HALCYON_8K, "0009000003-26-000012", "0009000004-26-000003", BRIGHTWATER_8K, BRIGHTWATER_8KA,
      "0009000006-26-000005", HALCYON_TRADE, "0009200001-26-000009", FUND_8K,
    ].sort());
    assert.equal(await num(`select count(*) from public.filings`), 10);
    assert.deepEqual(f.calls.map((x) => x.url), [currentFeedUrl(0, 100)]);
    assert.equal(f.calls[0].headers["user-agent"], UA);

    const again = await pollCurrentFilings(c, sec, { now: new Date("2026-11-04T23:00:10Z") });
    assert.deepEqual(again, { fetchedPages: 1, newFilings: [] });
    assert.equal(await num(`select count(*) from public.filings`), 10);
  });

  await test("pollCurrentFilings: categories, dates, links, the right company for each filing", async () => {
    const halcyon = (await filing(HALCYON_8K))!;
    assert.equal(Number(halcyon.cik), 9000002);
    assert.equal(halcyon.form, "8-K");
    assert.deepEqual(halcyon.items, ["2.02", "9.01"]);
    assert.equal(halcyon.category, "earnings");
    assert.equal(halcyon.accepted_at.toISOString(), "2026-11-04T22:21:40.000Z");
    assert.equal(halcyon.filed_date, "2026-11-04");
    assert.equal(halcyon.index_url, `${ARCHIVES}/9000002/000900000226000107/${HALCYON_8K}-index.htm`);
    assert.equal(halcyon.primary_url, halcyon.index_url);
    assert.equal(halcyon.detail_checked_at, null);
    assert.equal(halcyon.matched_at, null, "a live filing is still to be alerted on");
    assert.equal((await filing(NORTHWIND_8K))!.category, "news");
    assert.equal((await filing("0009000003-26-000012"))!.category, "earnings");
    assert.equal((await filing("0009000006-26-000005"))!.category, "ipo");
    const late = (await filing(BRIGHTWATER_8KA))!;
    assert.deepEqual([late.form, late.category, late.filed_date, late.items], ["8-K/A", "news", "2026-11-03", ["5.02"]]);
    // An insider trade belongs to the company, never to the person who reported it.
    const trade = (await filing(HALCYON_TRADE))!;
    assert.deepEqual([Number(trade.cik), trade.form, trade.category], [9000002, "4", "insider"]);
    assert.equal(trade.index_url, `${ARCHIVES}/9000002/000910000126000004/${HALCYON_TRADE}-index.htm`);
    // A big investor's report belongs to the company invested in, not to the investor.
    const stake = (await filing("0009200001-26-000009"))!;
    assert.deepEqual([Number(stake.cik), stake.category], [9000003, "news"]);
    assert.equal(await num(`select count(*) from public.companies where cik in (9100001, 9200001)`), 0, "no company row for the person or the investor");
    // A form the site does not collect is ignored.
    assert.equal(await num(`select count(*) from public.filings where accession = '0009123456-26-000777' or form = '144'`), 0);
  });

  await test("pollCurrentFilings adds a minimal company row for a company it has not seen", async () => {
    const fund = (await one<{ name: string; ticker: string | null; exchange: string | null; tracked: boolean }>(`select name, ticker, exchange, tracked from public.companies where cik = 9999999`))!;
    assert.deepEqual(fund, { name: "Private Fund LP", ticker: null, exchange: null, tracked: false });
    const vantage = (await one<{ name: string; ticker: string | null }>(`select name, ticker from public.companies where cik = 9000004`))!;
    assert.deepEqual(vantage, { name: "Vantage Orbital Inc.", ticker: null });
    // Not yet trading anywhere: its share registration is an IPO filing.
    assert.equal((await filing("0009000004-26-000003"))!.category, "ipo");
    assert.equal((await one<{ name: string }>(`select name from public.companies where cik = 9000001`))!.name, "NORTHWIND BIOTHERAPEUTICS, INC.", "a known company is left alone");
  });

  await test("pollCurrentFilings reads on until a page with nothing new, and no further", async () => {
    const mk = (n: number, minute: number): FeedEntry => ({
      form: n % 3 ? "8-K" : "10-Q", name: "NORTHWIND BIOTHERAPEUTICS, INC.", cik: 9000001, role: "Filer",
      accession: `0009000001-26-${String(100000 + n)}`, updated: new Date(Date.UTC(2026, 10, 5, 15, minute, n % 60)).toISOString().replace(".000Z", "-00:00"),
    });
    const noise = (n: number): FeedEntry => ({ ...mk(n, 0), form: "144", accession: `0009555555-26-${String(100000 + n)}` });
    const page0 = [...Array.from({ length: 60 }, (_, i) => mk(i, 30)), ...Array.from({ length: 40 }, (_, i) => noise(i))];
    const page1 = Array.from({ length: 100 }, (_, i) => noise(100 + i)); // nothing the site collects: says nothing about what is stored
    const page2 = [...Array.from({ length: 50 }, (_, i) => mk(60 + i, 20)), ...Array.from({ length: 50 }, (_, i) => noise(200 + i))];
    const page3 = [...Array.from({ length: 30 }, (_, i) => mk(80 + i, 10)), ...Array.from({ length: 70 }, (_, i) => noise(300 + i))]; // all stored already
    const page4 = Array.from({ length: 100 }, (_, i) => mk(900 + i, 5)); // must never be asked for
    const sec = stubSec({
      [currentFeedUrl(0, 100)]: feedXml(page0), [currentFeedUrl(100, 100)]: feedXml(page1), [currentFeedUrl(200, 100)]: feedXml(page2),
      [currentFeedUrl(300, 100)]: feedXml(page3), [currentFeedUrl(400, 100)]: feedXml(page4),
    });
    const before = await num(`select count(*) from public.filings`);
    const r = await pollCurrentFilings(c, sec.client, { now: new Date("2026-11-05T16:00:00Z") });
    assert.equal(r.fetchedPages, 4);
    assert.equal(r.newFilings.length, 110);
    assert.equal(await num(`select count(*) from public.filings`), before + 110);
    assert.deepEqual(sec.calls, [0, 100, 200, 300].map((s) => currentFeedUrl(s, 100)));
    assert.equal(await num(`select count(*) from public.filings where form = '144'`), 0);
    // maxPages is a hard stop.
    const capped = await pollCurrentFilings(c, stubSec({ [currentFeedUrl(0, 100)]: feedXml(Array.from({ length: 100 }, (_, i) => mk(2000 + i, 40))) }).client, { maxPages: 1 });
    assert.equal(capped.fetchedPages, 1);
    assert.equal(capped.newFilings.length, 100);
  });

  await test("pollCurrentFilings: 5 pages at most in normal running, 40 when nothing was stored in the last day", async () => {
    const endless = (label: number) => {
      const calls: string[] = [];
      const client: SecClient = {
        text: async (url) => {
          calls.push(url);
          const start = Number(/start=(\d+)/.exec(url)![1]);
          return feedXml(Array.from({ length: 100 }, (_, i) => ({
            form: "8-K", name: "Halcyon Grid Systems Corp", cik: 9000002, role: "Filer",
            accession: `0009000002-${label}-${String(start + i).padStart(6, "0")}`, updated: "2026-11-05T12:00:00-05:00",
          })));
        },
        json: async () => { throw new Error("not used"); },
        stats: () => ({ requests: calls.length, retries: 0, pausedUntil: null }),
      };
      return { client, calls };
    };
    const normal = endless(31);
    const a = await pollCurrentFilings(c, normal.client, { now: new Date("2026-11-05T18:00:00Z") });
    assert.equal(a.fetchedPages, 5);
    assert.equal(a.newFilings.length, 500);
    const afterDowntime = endless(32);
    const b = await pollCurrentFilings(c, afterDowntime.client, { now: new Date("2026-11-20T18:00:00Z") });
    assert.equal(b.fetchedPages, 40);
    assert.equal(b.newFilings.length, 4000);
    assert.equal(afterDowntime.calls[39], currentFeedUrl(3900, 100));
    await c.query(`delete from public.filings where accession like '0009000002-31-%' or accession like '0009000002-32-%' or accession like '0009000001-26-1%'`);
  });

  await test("pollCurrentFilings: a filing made by two companies goes to the one with a ticker; an SEC failure is passed on", async () => {
    const both: FeedEntry[] = [
      { form: "8-K", name: "Brightwater Funding Trust", cik: 9300001, role: "Filer", accession: "0009000005-26-000200", updated: "2026-11-05T09:00:00-05:00", folderCik: 9300001 },
      { form: "8-K", name: "Brightwater Payments, Inc.", cik: 9000005, role: "Filer", accession: "0009000005-26-000200", updated: "2026-11-05T09:00:00-05:00" },
      { form: "4", name: "DOE JANE", cik: 9100009, role: "Reporting", accession: "0009100009-26-000001", updated: "2026-11-05T08:00:00-05:00" },
    ];
    const r = await pollCurrentFilings(c, stubSec({ [currentFeedUrl(0, 100)]: feedXml(both) }).client, { maxPages: 2 });
    assert.deepEqual(r.newFilings, ["0009000005-26-000200"], "the insider trade waits for the company's own entry");
    assert.equal(Number((await filing("0009000005-26-000200"))!.cik), 9000005);
    assert.equal(await num(`select count(*) from public.companies where cik in (9300001, 9100009)`), 0);
    await c.query(`delete from public.filings where accession = '0009000005-26-000200'`);
    await assert.rejects(pollCurrentFilings(c, stubSec({ [currentFeedUrl(0, 100)]: fail(503) }).client, { maxPages: 2 }), SecHttpError);
    assert.equal(await num(`select count(*) from public.filings`), 10);
  });

  console.log("database: filing details");

  const halcyonFolder = `${ARCHIVES}/9000002/000900000226000107/`;
  const tradeFolder = `${ARCHIVES}/9000002/000910000126000004/`;
  const amendedFolder = filingFolderUrl(9000005, BRIGHTWATER_8KA);
  const detailRoutes: Record<string, string | (() => string)> = {
    [`${halcyonFolder}${HALCYON_8K}-index.htm`]: fx("index-8k-release.htm"),
    [`${halcyonFolder}hgrd-ex991_q32026.htm`]: fx("ex99-1-release.htm"),
    [`${tradeFolder}${HALCYON_TRADE}-index.htm`]: fx("index-form4.htm"),
    [`${tradeFolder}wk-form4_1730412345.xml`]: fx("form4-buy.xml"),
    [filingIndexUrl(9000005, BRIGHTWATER_8K)]: fx("index-8k-plain.htm"),
    // The corrected filing's index page is broken; its folder listing works.
    [filingIndexUrl(9000005, BRIGHTWATER_8KA)]: fail(500),
    [`${amendedFolder}index.json`]: JSON.stringify({ directory: { item: [{ name: `${BRIGHTWATER_8KA}-index.html` }, { name: "bwpy_8ka.htm" }, { name: "bwpy_ex99-1.htm" }, { name: "logo.jpg" }] } }),
    [`${amendedFolder}bwpy_ex99-1.htm`]: `<html><body><p>Exhibit 99.1</p><p>NEW YORK--(BUSINESS WIRE)--Brightwater Payments, Inc. (Nasdaq: BWPY) today said ${"its chief financial officer will step down. ".repeat(8)}</p></body></html>`,
    // Northwind's filing cannot be read at all for now.
    [filingIndexUrl(9000001, NORTHWIND_8K)]: fail(503),
  };
  const dayAfter = new Date("2026-11-05T12:00:00Z");

  await test("processFilingDetails: press release -> news row and headline; insider trade -> summary; errors recorded", async () => {
    const sec = stubSec(detailRoutes);
    const r = await processFilingDetails(c, sec.client, { now: dayAfter });
    assert.deepEqual(r, { done: 4, failed: 2 });

    // 1. The company-news filing with a press release attached.
    const halcyon = (await filing(HALCYON_8K))!;
    assert.equal(halcyon.title, RELEASE_TITLE);
    assert.equal(halcyon.primary_url, `${halcyonFolder}hgrd-20261104.htm`);
    assert.equal(halcyon.primary_document, "hgrd-20261104.htm");
    assert.ok(halcyon.detail_checked_at);
    assert.equal(halcyon.detail_error, null);
    const news = await rows<Record<string, unknown>>(`select * from public.news where accession = $1`, [HALCYON_8K]);
    assert.equal(news.length, 1);
    assert.equal(news[0].source, "sec");
    assert.equal(news[0].exhibit, "EX-99.1");
    assert.equal(Number(news[0].cik), 9000002);
    assert.equal(news[0].ticker, "HGRD");
    assert.equal(news[0].company_name, "Halcyon Grid Systems Corp");
    assert.equal(news[0].title, RELEASE_TITLE);
    assert.equal(news[0].url, `${halcyonFolder}hgrd-ex991_q32026.htm`);
    assert.equal((news[0].published_at as Date).toISOString(), "2026-11-04T22:21:40.000Z");
    assert.equal(news[0].body_text, htmlToText(fx("ex99-1-release.htm")));
    assert.equal(news[0].matched_at, null);

    // 2. The insider trade: a summary built from the filing's numbers, with no AI.
    const trade = (await filing(HALCYON_TRADE))!;
    assert.equal(trade.primary_url, `${tradeFolder}xslF345X05/wk-form4_1730412345.xml`);
    assert.equal(trade.primary_document, "wk-form4_1730412345.xml");
    assert.ok(trade.detail_checked_at);
    assert.equal(trade.title, null);
    const s = (await one<Record<string, unknown>>(`select * from public.summaries where accession = $1`, [HALCYON_TRADE]))!;
    assert.deepEqual(
      [s.kind, s.model, s.prompt_version, s.category, s.tone, s.importance, s.news_id, s.input_tokens],
      ["rule", null, 1, "insider", "Good news", "High", null, null],
    );
    assert.equal(s.headline, "Chief Financial Officer bought 40,000 shares");
    assert.equal(s.one_sentence, "The Chief Financial Officer bought about $1.1 million of stock on the open market.");
    assert.deepEqual(s.bullets, [
      "Who: Elena R Marsh (Chief Financial Officer).",
      "Bought 40,000 shares at about $27.50 a share, about $1.1 million in total.",
      "This was an open-market trade, made at the market price.",
    ]);
    assert.equal(s.why_it_matters, "Insiders buying with their own money is often read as a sign of confidence in the company.");
    assert.equal(s.source_url, trade.primary_url);

    // 3. Company news with no press release: main document found, no news row.
    const plain = (await filing(BRIGHTWATER_8K))!;
    assert.equal(plain.primary_document, "bwpy_8k.htm");
    assert.ok(plain.detail_checked_at);
    assert.equal(await num(`select count(*) from public.news where accession = $1`, [BRIGHTWATER_8K]), 0);

    // 4. Index page broken: the folder listing is used; the release has no headline of its own.
    const amended = (await filing(BRIGHTWATER_8KA))!;
    assert.equal(amended.primary_url, `${amendedFolder}bwpy_8ka.htm`);
    assert.ok(amended.detail_checked_at);
    assert.equal(amended.title, null);
    const fallback = (await one<{ title: string; exhibit: string; url: string }>(`select title, exhibit, url from public.news where accession = $1`, [BRIGHTWATER_8KA]))!;
    assert.deepEqual(fallback, { title: "Executive or board change (corrected)", exhibit: "EX-99.1", url: `${amendedFolder}bwpy_ex99-1.htm` });

    // 5. Two filings could not be read: the reason is kept and they stay on the list.
    for (const accession of [NORTHWIND_8K, FUND_8K]) {
      const f = (await filing(accession))!;
      assert.equal(f.detail_checked_at, null, accession);
      assert.ok(f.detail_error && f.detail_error.length <= 300, accession);
      assert.equal(f.primary_url, f.index_url);
    }
    assert.match((await filing(NORTHWIND_8K))!.detail_error!, /503/);
    assert.match((await filing(FUND_8K))!.detail_error!, /404/);

    // 6. Forms with nothing to read are only marked as looked at; nothing was asked of the SEC for them.
    assert.equal(await num(`select count(*) from public.filings where detail_checked_at is null`), 2);
    assert.equal(await num(`select count(*) from public.filings where detail_checked_at is not null and primary_url = index_url and form in ('10-Q', 'S-1', '424B4', 'SCHEDULE 13D')`), 4);
    assert.ok(sec.calls.every((u) => u.startsWith("https://www.sec.gov/Archives/")), "only the SEC's archive was read");
    assert.ok(!sec.calls.some((u) => /000900000326000012|000900000426000003|000920000126000009|000900000626000005/.test(u)));
    assert.equal(await num(`select count(*) from public.news where source = 'sec' and (url not like 'https://www.sec.gov/Archives/%' or cik is null)`), 0);
  });

  await test("processFilingDetails: a failed filing is tried again; nothing is written twice", async () => {
    const sec = stubSec({ ...detailRoutes, [filingIndexUrl(9000001, NORTHWIND_8K)]: fx("index-8k-plain.htm") });
    const r = await processFilingDetails(c, sec.client, { now: new Date("2026-11-05T12:05:00Z") });
    assert.deepEqual(r, { done: 1, failed: 1 });
    const northwind = (await filing(NORTHWIND_8K))!;
    assert.ok(northwind.detail_checked_at);
    assert.equal(northwind.detail_error, null, "the old error is cleared");
    assert.equal(northwind.primary_document, "bwpy_8k.htm");
    assert.equal((await filing(FUND_8K))!.detail_checked_at, null);
    assert.ok(!sec.calls.some((u) => u.includes("000900000226000107")), "finished filings are not read again");
    assert.equal(await num(`select count(*) from public.news where source = 'sec'`), 2);
    assert.equal(await num(`select count(*) from public.summaries`), 1);

    // Even if a filing is put back on the list, its news row and summary are not duplicated.
    await c.query(`update public.filings set detail_checked_at = null where accession = any($1)`, [[HALCYON_8K, HALCYON_TRADE]]);
    const redo = await processFilingDetails(c, stubSec(detailRoutes).client, { now: new Date("2026-11-05T12:06:00Z"), limit: 2 });
    assert.deepEqual(redo, { done: 2, failed: 0 }, "never-tried filings come before the one that keeps failing");
    assert.equal(await num(`select count(*) from public.news where source = 'sec'`), 2);
    assert.equal(await num(`select count(*) from public.summaries`), 1);
  });

  await test("processFilingDetails: stops when the SEC has told us to stop; gives up on a filing once it is old", async () => {
    const paused = stubSec(detailRoutes);
    paused.pause(Date.now() + 600_000);
    assert.deepEqual(await processFilingDetails(c, paused.client, { now: new Date("2026-11-05T12:10:00Z") }), { done: 0, failed: 0 });
    assert.deepEqual(paused.calls, []);

    // Three days and a bit after the filing: it is closed, with its last error kept, and the SEC is not asked.
    const later = stubSec(detailRoutes);
    assert.deepEqual(await processFilingDetails(c, later.client, { now: new Date("2026-11-08T00:00:00Z") }), { done: 0, failed: 0 });
    const fund = (await filing(FUND_8K))!;
    assert.ok(fund.detail_checked_at);
    assert.match(fund.detail_error!, /404/);
    assert.deepEqual(later.calls, []);
    assert.equal(await num(`select count(*) from public.filings where detail_checked_at is null`), 0);
    // A shorter limit set by the caller is respected.
    await c.query(`update public.filings set detail_checked_at = null, detail_error = null where accession = $1`, [BRIGHTWATER_8K]);
    assert.deepEqual(await processFilingDetails(c, stubSec(detailRoutes).client, { now: dayAfter, maxAgeHours: 6 }), { done: 0, failed: 0 });
    assert.ok((await filing(BRIGHTWATER_8K))!.detail_checked_at);
  });

  await test("processFilingDetails: a very long release is cut to 200,000 characters", async () => {
    await c.query(
      `insert into public.filings (accession, cik, form, items, accepted_at, filed_date, primary_url, index_url, category)
       values ('0009000001-26-000050', 9000001, '6-K', '{}', '2026-11-05T11:00:00Z', '2026-11-05', $1, $1, 'news')`,
      [filingIndexUrl(9000001, "0009000001-26-000050")],
    );
    const folder = filingFolderUrl(9000001, "0009000001-26-000050");
    const index = fx("index-8k-plain.htm").replace("EX-10.1</TD>", "EX-99.1</TD>").replace(/\/Archives\/edgar\/data\/9000005\/000900000526000088\//g, new URL(folder).pathname);
    const sec = stubSec({
      [filingIndexUrl(9000001, "0009000001-26-000050")]: index,
      [`${folder}bwpy_ex101.htm`]: `<p>Northwind Announces a Very Long Press Release Indeed</p><p>${"word ".repeat(50_000)}</p>`,
    });
    assert.deepEqual(await processFilingDetails(c, sec.client, { now: dayAfter }), { done: 1, failed: 0 });
    const n = (await one<{ title: string; len: number }>(`select title, length(body_text) as len from public.news where accession = '0009000001-26-000050'`))!;
    assert.equal(n.title, "Northwind Announces a Very Long Press Release Indeed");
    assert.equal(n.len, MAX_BODY_CHARS);
    assert.equal((await filing("0009000001-26-000050"))!.title, n.title);
  });

  console.log("database: newswires");

  const [PRN_1, PRN_2] = PRESS_FEEDS.filter((f) => f.source === "prnewswire").map((f) => f.url);
  const BW = PRESS_FEEDS.find((f) => f.source === "businesswire")!.url;
  const bwFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Brightwater Payments Names New Chief Financial Officer</title><link>https://wire.test/bw/brightwater-cfo</link>
      <description>NEW YORK--(BUSINESS WIRE)--Brightwater Payments, Inc. (Nasdaq: BWPY) today named a new CFO.</description><pubDate>Thu, 05 Nov 2026 13:00:00 GMT</pubDate></item>
    <item><title>Maple Gold Drills 12 m of 3 g/t Gold</title><link>https://wire.test/bw/maple-gold</link>
      <description>TORONTO--(BUSINESS WIRE)--Maple Gold Corp. (TSX: HGRD) reports results.</description><pubDate>Thu, 05 Nov 2026 12:00:00 GMT</pubDate></item>
    <item><title>Old-style link (NYSE: HGRD)</title><link>http://wire.test/bw/insecure</link><pubDate>Thu, 05 Nov 2026 11:00:00 GMT</pubDate></item>
    <item><title></title><link>https://wire.test/bw/untitled</link><description>(NYSE: HGRD)</description><pubDate>Thu, 05 Nov 2026 11:00:00 GMT</pubDate></item>
    <item><title>Halcyon Grid Systems Reports Record Q3 Revenue of $48.2 Million, Up 61% Year-Over-Year</title><link>https://example.com/news/halcyon-q3</link>
      <description>The same release as on the other wire (NYSE: HGRD)</description><pubDate>Wed, 04 Nov 2026 22:25:00 GMT</pubDate></item>
  </channel></rss>`;

  await test("the press reader names itself plainly and has feeds for the four newswires", () => {
    assert.match(PRESS_USER_AGENT, /^BigStocksBot\/1\.0 \(\+https?:\/\/[^\s)]+\)$/);
    assert.deepEqual([...new Set(PRESS_FEEDS.map((f) => f.source))].sort(), ["accessnewswire", "businesswire", "globenewswire", "prnewswire"]);
    assert.ok(PRESS_FEEDS.every((f) => f.url.startsWith("https://") && !/sec\.gov/.test(f.url)));
  });

  await test("pollPressFeeds stores matched and unmatched releases once; one failing feed does not stop the rest", async () => {
    resetPressBackoff();
    const f = fakeFetch((url) => (url === PRN_1 ? { body: fx("press-rss.xml") } : url === PRN_2 ? new TypeError("fetch failed") : url === BW ? { body: bwFeed } : { status: 500 }));
    const { result: r, lines } = await quietly(() => pollPressFeeds(c, { fetch: f.fn }));
    assert.equal(r.sources, 2, "only the two sources that are switched on");
    assert.deepEqual(f.calls.map((x) => x.url).sort(), [PRN_1, PRN_2, BW].sort(), "sources that are switched off are never asked");
    for (const call of f.calls) {
      assert.equal(call.headers["user-agent"], PRESS_USER_AGENT);
      assert.ok(!/acme|sec-contact/i.test(call.headers["user-agent"]), "not the SEC identity");
    }
    assert.equal(lines.length, 1, "the failing feed leaves one line");
    assert.match(lines[0], /\[press\] prnewswire: .*fetch failed/);
    assert.equal(r.newItems.length, 8);
    const stored = await rows<{ id: string; source: string; ticker: string; cik: string | null; company_name: string | null; body_text: string | null; url: string; title: string; published_at: Date }>(
      `select id, source, ticker, cik, company_name, body_text, url, title, published_at from public.news where source <> 'sec' order by published_at desc, id`,
    );
    assert.deepEqual(stored.map((n) => Number(n.id)).sort(), [...r.newItems].sort());
    const by = (url: string) => stored.find((n) => n.url === url)!;
    // Matched to a company through its ticker; the company's name comes from our own list.
    const northwind = by("https://example.com/news/northwind-phase-2");
    assert.deepEqual([northwind.source, northwind.ticker, Number(northwind.cik), northwind.company_name], ["prnewswire", "NWBT", 9000001, "NORTHWIND BIOTHERAPEUTICS, INC."]);
    assert.equal(northwind.published_at.toISOString(), "2026-11-04T22:41:00.000Z");
    assert.equal(northwind.title, "Northwind Biotherapeutics Announces Positive Topline Phase 2 Results for NW-210 in Rare Liver Disease");
    assert.equal(Number(by("https://example.com/news/copperline-red-mesa").cik), 9000003);
    assert.deepEqual([by("https://wire.test/bw/brightwater-cfo").source, Number(by("https://wire.test/bw/brightwater-cfo").cik)], ["businesswire", 9000005]);
    // A ticker we do not know: stored without a company, with the name the release gave.
    const vantage = by("https://example.com/news/vantage-ipo");
    assert.deepEqual([vantage.ticker, vantage.cik, vantage.company_name], ["VORB", null, "Vantage Orbital Inc."]);
    assert.equal(by("https://example.com/news/silverpeak-conference").cik, null);
    // A Toronto ticker that happens to match a US one is NOT attached to the US company.
    const maple = by("https://wire.test/bw/maple-gold");
    assert.deepEqual([maple.ticker, maple.cik], ["HGRD", null]);
    // The same link on two wires is stored once, for the first source read.
    assert.equal(stored.filter((n) => n.url === "https://example.com/news/halcyon-q3").length, 1);
    // No ticker, no https link or no title: not stored.
    assert.ok(!stored.some((n) => /bakery|insecure|untitled/.test(n.url)));
    // Neither source allows its text to be kept.
    assert.ok(stored.every((n) => n.body_text === null));
    assert.equal(await num(`select count(*) from public.news where source <> 'sec' and (accession is not null or exhibit is not null)`), 0);

    const again = await quietly(() => pollPressFeeds(c, { fetch: f.fn }));
    assert.deepEqual(again.result, { sources: 2, newItems: [] });
    assert.equal(await num(`select count(*) from public.news where source <> 'sec'`), 8);
  });

  await test("pollPressFeeds respects enabled = false and can_store_body", async () => {
    resetPressBackoff();
    await c.query(`update public.news_sources set enabled = false where key = 'prnewswire'`);
    await c.query(`update public.news_sources set can_store_body = true where key = 'businesswire'`);
    const item = (slug: string, text: string) => `<item><title>${text}</title><link>https://wire.test/${slug}</link><description>${text} in full.</description><pubDate>Thu, 05 Nov 2026 15:00:00 GMT</pubDate></item>`;
    const f = fakeFetch((url) => ({ body: `<rss><channel>${item(url === BW ? "bw/new" : "prn/new", "Halcyon Grid Systems (NYSE: HGRD) wins a contract")}</channel></rss>` }));
    const r = await pollPressFeeds(c, { fetch: f.fn });
    assert.deepEqual(f.calls.map((x) => x.url), [BW], "the switched-off source is not even asked");
    assert.equal(r.sources, 1);
    assert.equal(r.newItems.length, 1);
    const n = (await one<{ source: string; body_text: string; cik: string }>(`select source, body_text, cik from public.news where id = $1`, [r.newItems[0]]))!;
    assert.deepEqual([n.source, n.body_text, Number(n.cik)], ["businesswire", "Halcyon Grid Systems (NYSE: HGRD) wins a contract in full.", 9000002]);
    assert.equal(await num(`select count(*) from public.news where url = 'https://wire.test/prn/new'`), 0);
    await c.query(`update public.news_sources set enabled = true where key = 'prnewswire'`);
    await c.query(`update public.news_sources set can_store_body = false where key = 'businesswire'`);
  });

  await test("pollPressFeeds leaves a feed alone after it refuses us", async () => {
    resetPressBackoff();
    let t = 1_800_000_000_000;
    const f = fakeFetch((url) => (url === BW ? { status: 403 } : { body: "<rss><channel></channel></rss>" }));
    await quietly(() => pollPressFeeds(c, { fetch: f.fn, now: () => t }));
    assert.equal(f.calls.filter((x) => x.url === BW).length, 1);
    await quietly(() => pollPressFeeds(c, { fetch: f.fn, now: () => t + 60_000 }));
    assert.equal(f.calls.filter((x) => x.url === BW).length, 1, "not asked again a minute later");
    assert.equal(f.calls.filter((x) => x.url === PRN_1).length, 2, "the other wire carries on");
    t += 31 * 60_000;
    await quietly(() => pollPressFeeds(c, { fetch: f.fn, now: () => t }));
    assert.equal(f.calls.filter((x) => x.url === BW).length, 2, "asked again after half an hour");
    resetPressBackoff();
  });

  console.log("database: company profile and health");

  const APPLE_8K = "0001140361-26-042798";
  const APPLE_EARNINGS = "0000320193-26-000024";
  const appleRoutes = {
    [submissionsUrl(320193)]: fx("submissions-320193.json"),
    [companyAtomUrl(320193)]: fx("company-atom-320193.xml"),
  };

  await test("refreshCompanyProfile fills the company and stores its recent filings as history", async () => {
    // A filing the live feed stored a moment ago, not yet looked at and not yet alerted on.
    await c.query(
      `insert into public.filings (accession, cik, form, items, accepted_at, filed_date, primary_url, index_url, category)
       values ($1, 320193, '8-K', '{2.02,9.01}', '2026-11-02T21:30:23Z', '2026-11-02', $2, $2, 'earnings')`,
      [APPLE_EARNINGS, filingIndexUrl(320193, APPLE_EARNINGS)],
    );
    const sec = stubSec(appleRoutes);
    // Five minutes after Apple's newest company-news filing was accepted.
    await refreshCompanyProfile(c, sec.client, 320193, { now: new Date("2026-11-09T21:35:00Z") });
    assert.deepEqual(sec.calls, [submissionsUrl(320193), companyAtomUrl(320193)]);

    const co = (await one<Record<string, unknown>>(`select * from public.companies where cik = 320193`))!;
    assert.deepEqual(
      [co.name, co.sic, co.sic_description, co.website, co.phone, co.fiscal_year_end, co.city, co.state, co.filer_category, co.is_emerging_growth],
      ["Apple Inc. (as first loaded)", "3571", "Electronic Computers", null, "(408) 996-1010", "0926", "Cupertino", "CA", "Large accelerated filer", false],
    );
    assert.deepEqual([co.ticker, co.exchange, co.tracked], ["AAPL", "Nasdaq", true], "the ticker list's columns are untouched");
    assert.ok(co.profile_checked_at);
    assert.equal(co.facts_checked_at, null);

    assert.equal(await filing(APPLE_8K), undefined, "a filing accepted minutes ago is left to the live feed, which alerts on it");
    const stored = await rows<{ accession: string; form: string; category: string | null; filed_date: string; detail_checked_at: Date | null; matched_at: Date | null; primary_url: string; index_url: string }>(
      `select accession, form, category, filed_date::text, detail_checked_at, matched_at, primary_url, index_url from public.filings where cik = 320193`,
    );
    assert.equal(stored.length, 60, "at most 60, the newest first (59 new ones and the one already there)");
    assert.ok(stored.every((f) => f.category !== null && f.filed_date >= "2025-10-05"));
    assert.ok(stored.every((f) => f.primary_url.startsWith("https://www.sec.gov/Archives/edgar/data/320193/") && /-index\.htm$/.test(f.index_url)));
    assert.ok(!stored.some((f) => ["144", "3", "424B2", "25-NSE", "S-8", "FWP"].includes(f.form)), "only forms the site collects");
    const history = stored.filter((f) => f.accession !== APPLE_EARNINGS);
    assert.ok(history.every((f) => f.detail_checked_at !== null && f.matched_at !== null), "history is never alerted on and never re-read");

    // The filing the live feed had stored keeps its place in the queue; only its gaps are filled.
    const live = (await filing(APPLE_EARNINGS))!;
    assert.equal(live.matched_at, null);
    assert.equal(live.detail_checked_at, null);
    assert.equal(live.primary_document, "aapl-20261102.htm");
    assert.equal(live.primary_url, `${ARCHIVES}/320193/000032019326000024/aapl-20261102.htm`);
    assert.equal(live.accepted_at.toISOString(), "2026-11-02T21:30:23.000Z");

    // Exact time from the company feed where it has one; otherwise 4 PM New York on the filing date.
    const annual = (await filing("0000320193-26-000026"))!;
    assert.deepEqual([annual.form, annual.category, annual.accepted_at.toISOString()], ["10-K", "earnings", "2026-11-03T23:05:15.000Z"]);
    assert.equal(annual.primary_url, `${ARCHIVES}/320193/000032019326000026/aapl-20260926.htm`);
    const trade = (await filing("0001140361-26-042149"))!;
    assert.deepEqual([trade.form, trade.category, trade.filed_date, trade.accepted_at.toISOString()], ["4", "insider", "2026-11-05", "2026-11-05T21:00:00.000Z"]);
    assert.equal(trade.primary_url, `${ARCHIVES}/320193/000114036126042149/xslF345X06/form4.xml`);
    assert.equal(trade.primary_document, "form4.xml");
    assert.equal(trade.index_url, filingIndexUrl(320193, "0001140361-26-042149"));

    // The next day the newest filing is history too. Running again changes nothing else.
    await refreshCompanyProfile(c, stubSec(appleRoutes).client, 320193, { now: new Date("2026-11-10T15:00:00Z") });
    const newest = (await filing(APPLE_8K))!;
    assert.deepEqual([newest.category, newest.accepted_at.toISOString(), newest.items], ["news", "2026-11-09T21:30:40.000Z", ["8.01", "9.01"]]);
    assert.ok(newest.matched_at && newest.detail_checked_at);
    assert.equal(newest.primary_url, `${ARCHIVES}/320193/000114036126042798/ef20085077_8k.htm`);
    assert.equal(await num(`select count(*) from public.filings where cik = 320193`), 61);
    assert.equal((await filing(APPLE_EARNINGS))!.matched_at, null);
    assert.equal(await num(`select count(*) from public.filings where cik = 320193 and matched_at is null`), 1, "nothing but the live filing can be alerted on");
  });

  await test("refreshCompanyProfile: an emerging growth company, with the company feed failing", async () => {
    const sec = stubSec({ [submissionsUrl(2074652)]: fx("submissions-2074652.json"), [companyAtomUrl(2074652)]: fail(503) });
    await refreshCompanyProfile(c, sec.client, 2074652, { now: new Date("2026-11-10T15:00:00Z") });
    const co = (await one<Record<string, unknown>>(`select * from public.companies where cik = 2074652`))!;
    assert.equal(co.is_emerging_growth, true);
    assert.equal(co.filer_category, "Non-accelerated filer | Smaller reporting company | Emerging growth company");
    assert.deepEqual([co.sic, co.city, co.state, co.fiscal_year_end, co.phone], ["7372", "Valencia", "Spain", "0430", "15623126022"]);
    assert.ok(co.profile_checked_at);
    const stored = await rows<{ accession: string; form: string; category: string; at: Date }>(
      `select accession, form, category, accepted_at as at from public.filings where cik = 2074652 order by accepted_at desc`,
    );
    // The last 400 days only; forms the site does not collect (3, 8-A12G, NT 10-Q, EFFECT, CORRESP, UPLOAD) are left out.
    assert.deepEqual(stored.map((f) => [f.form, f.category]), [["10-Q", "earnings"], ["10-K", "earnings"], ["10-Q", "earnings"], ["10-Q", "earnings"], ["S-1/A", "news"], ["S-1/A", "news"]]);
    assert.equal(stored[0].at.toISOString(), "2026-09-14T20:00:00.000Z", "4 PM in New York, in summer");
    assert.equal(stored[2].at.toISOString(), "2026-03-13T20:00:00.000Z");
    assert.equal(stored[3].at.toISOString(), "2025-12-18T21:00:00.000Z", "4 PM in New York, in winter");
    assert.equal(await num(`select count(*) from public.filings where cik = 2074652 and (matched_at is null or detail_checked_at is null)`), 0);
  });

  await test("refreshCompanyProfile: a 404 is noted so the company is not asked for again at once; other failures are not", async () => {
    await refreshCompanyProfile(c, stubSec({}).client, 2084272);
    const co = (await one<{ profile_checked_at: Date | null; sic: string | null; name: string }>(`select profile_checked_at, sic, name from public.companies where cik = 2084272`))!;
    assert.ok(co.profile_checked_at);
    assert.deepEqual([co.sic, co.name], [null, "Unity Forge Inc"]);
    assert.equal(await num(`select count(*) from public.filings where cik = 2084272`), 0);

    await assert.rejects(refreshCompanyProfile(c, stubSec({ [submissionsUrl(9000003)]: fail(503) }).client, 9000003), SecHttpError);
    assert.equal((await one<{ p: Date | null }>(`select profile_checked_at as p from public.companies where cik = 9000003`))!.p, null, "tried again next time");
    // A company the table has never seen gets its row from the SEC's record.
    await refreshCompanyProfile(c, stubSec({ [submissionsUrl(9400001)]: JSON.stringify({ name: "Newly Seen Corp", sic: "1000", category: "<br>Emerging growth company" }) }).client, 9400001);
    const fresh = (await one<{ name: string; is_emerging_growth: boolean; tracked: boolean }>(`select name, is_emerging_growth, tracked from public.companies where cik = 9400001`))!;
    assert.deepEqual(fresh, { name: "Newly Seen Corp", is_emerging_growth: true, tracked: false });
  });

  await test("refreshCompanyHealth scores the SEC's numbers and stores a snapshot (scorer passed in)", async () => {
    await c.query(`update public.companies set sic = '3990', is_emerging_growth = true where cik = 2084272`);
    const seen: { facts: unknown; profile: unknown; opts: unknown }[] = [];
    type Fake = { verdict: "Strong" | "Mixed" | "Weak"; tags: number; today: string; ruleSet: string };
    const deps: HealthDeps<Fake> = {
      scoreCompany: (facts, profile, opts) => {
        seen.push({ facts, profile, opts });
        const f = facts as { facts: Record<string, Record<string, unknown>> };
        return { verdict: "Mixed", tags: Object.keys(f.facts["us-gaap"]).length, today: opts.today, ruleSet: opts.growthRules && profile.isEmergingGrowth ? "growth" : "standard" };
      },
      saveSnapshot: async (db, cik, r) => {
        await db.query(
          `insert into public.fundamentals_snapshots (cik, as_of, quarters, ttm, score, verdict, rule_set) values ($1, $2, '[]', '{}', $3, $4, $5)
           on conflict (cik, as_of) do update set verdict = excluded.verdict, score = excluded.score`,
          [cik, r.today, JSON.stringify({ tags: r.tags }), r.verdict, r.ruleSet],
        );
      },
    };
    const sec = stubSec({ [companyFactsUrl(2084272)]: fx("companyfacts-2084272.json") });
    await refreshCompanyHealth(c, sec.client, 2084272, { today: "2026-11-10", growthRules: true }, deps);
    assert.deepEqual(sec.calls, [companyFactsUrl(2084272)]);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].profile, { sic: "3990", isEmergingGrowth: true });
    assert.deepEqual(seen[0].opts, { today: "2026-11-10", growthRules: true });
    assert.equal(Number((seen[0].facts as { cik: number | string }).cik), 2084272);
    const snap = (await one<{ as_of: string; verdict: string; rule_set: string; score: object }>(`select as_of::text, verdict, rule_set, score from public.fundamentals_snapshots where cik = 2084272`))!;
    assert.deepEqual(snap, { as_of: "2026-11-10", verdict: "Mixed", rule_set: "growth", score: { tags: 4 } });
    assert.ok((await one<{ f: Date | null }>(`select facts_checked_at as f from public.companies where cik = 2084272`))!.f);
    // Running it again the same night replaces the snapshot instead of adding one.
    await refreshCompanyHealth(c, sec.client, 2084272, { today: "2026-11-10", growthRules: true }, deps);
    assert.equal(await num(`select count(*) from public.fundamentals_snapshots`), 1);

    // No financial data on file: noted, nothing stored, the scorer is not called.
    await refreshCompanyHealth(c, stubSec({}).client, 2074652, { today: "2026-11-10", growthRules: false }, deps);
    assert.equal(seen.length, 2);
    assert.ok((await one<{ f: Date | null }>(`select facts_checked_at as f from public.companies where cik = 2074652`))!.f);
    assert.equal(await num(`select count(*) from public.fundamentals_snapshots where cik = 2074652`), 0);

    // The SEC failing for a while is not "checked"; a scorer that throws is, so one company cannot block the queue.
    await assert.rejects(refreshCompanyHealth(c, stubSec({ [companyFactsUrl(320193)]: fail(503) }).client, 320193, { today: "2026-11-10", growthRules: false }, deps), SecHttpError);
    assert.equal((await one<{ f: Date | null }>(`select facts_checked_at as f from public.companies where cik = 320193`))!.f, null);
    const broken: HealthDeps<unknown> = { scoreCompany: () => { throw new Error("unexpected numbers"); }, saveSnapshot: async () => {} };
    await assert.rejects(refreshCompanyHealth(c, stubSec({ [companyFactsUrl(320193)]: "{}" }).client, 320193, { today: "2026-11-10", growthRules: false }, broken), /unexpected numbers/);
    assert.ok((await one<{ f: Date | null }>(`select facts_checked_at as f from public.companies where cik = 320193`))!.f);
    await assert.rejects(refreshCompanyHealth(c, stubSec({}).client, 123456789, { today: "2026-11-10", growthRules: false }, deps), /not in the companies table/);
    assert.equal(await num(`select count(*) from public.fundamentals_snapshots`), 1, "no price or anything else was stored: one snapshot");
  });

  await test("refreshCompanyHealth with the real health check (lib/health): a snapshot row that the table accepts", async () => {
    await c.query(`delete from public.fundamentals_snapshots where cik = 2084272`);
    const sec = stubSec({ [companyFactsUrl(2084272)]: fx("companyfacts-2084272.json") });
    await refreshCompanyHealth(c, sec.client, 2084272, { today: "2026-11-11", growthRules: false });
    const snap = (await one<{ as_of: string; verdict: string | null; no_score_reason: string | null; rule_set: string }>(
      `select as_of::text, verdict, no_score_reason, rule_set from public.fundamentals_snapshots where cik = 2084272`,
    ))!;
    assert.equal(snap.as_of, "2026-11-11");
    assert.ok(snap.verdict === null ? Boolean(snap.no_score_reason) : ["Strong", "Mixed", "Weak"].includes(snap.verdict), JSON.stringify(snap));
    assert.equal(snap.rule_set, "standard", "the growth rules stay off until they are switched on");
    assert.deepEqual(sec.calls, [companyFactsUrl(2084272)], "one request, for the SEC's financial data; no price from anywhere");
  });

  await test("nextCompaniesToRefresh: tracked companies, never-checked first, then the longest-waiting", async () => {
    await c.query(`update public.companies set tracked = false, profile_checked_at = null, facts_checked_at = null`);
    await c.query(`update public.companies set tracked = true, profile_checked_at = now() - interval '30 hours', facts_checked_at = now() - interval '2 hours' where cik = 320193`);
    await c.query(`update public.companies set tracked = true, profile_checked_at = now() - interval '50 hours', facts_checked_at = null where cik = 2074652`);
    await c.query(`update public.companies set tracked = true, profile_checked_at = null, facts_checked_at = now() - interval '26 hours' where cik = 2084272`);
    await c.query(`update public.companies set tracked = true, profile_checked_at = now() - interval '1 hour', facts_checked_at = now() - interval '100 hours' where cik = 9000001`);
    assert.deepEqual(await nextCompaniesToRefresh(c, "profile", 10, 24), [2084272, 2074652, 320193]);
    assert.deepEqual(await nextCompaniesToRefresh(c, "profile", 2, 24), [2084272, 2074652]);
    assert.deepEqual(await nextCompaniesToRefresh(c, "profile", 10, 40), [2084272, 2074652]);
    assert.deepEqual(await nextCompaniesToRefresh(c, "profile", 10, 0.5), [2084272, 2074652, 320193, 9000001]);
    assert.deepEqual(await nextCompaniesToRefresh(c, "facts", 10, 24), [2074652, 9000001, 2084272]);
    assert.deepEqual(await nextCompaniesToRefresh(c, "facts", 0, 24), []);
  });

  console.log("database: categories for copied rows");

  await test("classifyFilings fills only missing categories, only for forms the site collects", async () => {
    const url = (n: number) => `${ARCHIVES}/9000001/00090000012500000${n}/x.htm`;
    await c.query(
      `insert into public.filings (accession, cik, form, items, accepted_at, filed_date, primary_url, index_url, category) values
         ('0009000001-25-000001', 9000001, '10-Q',  '{}',          '2025-08-01T20:00:00Z', '2025-08-01', $1, $1, null),
         ('0009000001-25-000002', 9000001, '8-k/a ', '{2.02,9.01}', '2025-08-02T20:00:00Z', '2025-08-02', $2, $2, null),
         ('0009000001-25-000003', 9000001, '144',   '{}',          '2025-08-03T20:00:00Z', '2025-08-03', $3, $3, null),
         ('0009000001-25-000004', 9000001, '10-Q',  '{}',          '2025-08-04T20:00:00Z', '2025-08-04', $4, $4, 'news'),
         ('0009000004-25-000005', 9000004, 'S-1',   '{}',          '2025-08-05T20:00:00Z', '2025-08-05', $5, $5, null),
         ('0009000005-25-000006', 9000005, 'S-1',   '{}',          '2025-08-06T20:00:00Z', '2025-08-06', $6, $6, null)`,
      [1, 2, 3, 4, 5, 6].map(url),
    );
    assert.equal(await classifyFilings(c), 4);
    const cat = async (a: string) => (await filing(a))!.category;
    assert.equal(await cat("0009000001-25-000001"), "earnings");
    assert.equal(await cat("0009000001-25-000002"), "earnings", "company news that reports results");
    assert.equal(await cat("0009000001-25-000003"), null, "a form the site does not collect stays without one");
    assert.equal(await cat("0009000001-25-000004"), "news", "a category already set is never changed");
    assert.equal(await cat("0009000004-25-000005"), "ipo", "a company not yet trading: an IPO filing");
    assert.equal(await cat("0009000005-25-000006"), "news", "a company already trading: new shares, not an IPO");
    assert.equal(await classifyFilings(c), 0, "nothing left to do");
    // The limit is respected, and uncollected forms never use it up.
    await c.query(`update public.filings set category = null where accession in ('0009000001-25-000001', '0009000001-25-000002')`);
    assert.equal(await classifyFilings(c, 1), 1);
    assert.equal(await classifyFilings(c, 1), 1);
    assert.equal(await classifyFilings(c, 1), 0);
  });

  await test("nothing stored points anywhere but the SEC's archive, and no price was stored", async () => {
    assert.equal(await num(`select count(*) from public.filings where primary_url not like 'https://www.sec.gov/Archives/%' or index_url not like 'https://www.sec.gov/Archives/%'`), 0);
    assert.equal(await num(`select count(*) from public.summaries where source_url not like 'https://www.sec.gov/Archives/%'`), 0);
    const visible = await rows<{ t: string }>(`select headline || ' ' || coalesce(one_sentence, '') || ' ' || array_to_string(bullets, ' ') || ' ' || why_it_matters as t from public.summaries`);
    for (const v of visible) assert.ok(!/\b(?:Buy|Sell)\b|10-Q|8-K|Form 4/.test(v.t), v.t);
  });
}

async function main() {
  await clientTests();
  await parserTests();

  const admin = describeTarget(ADMIN_URL);
  if (!admin.isLocal) throw new Error(`Database tests only run against a local Postgres. TEST_PG_URL points at ${admin.host}.`);
  let root: Client | null = null;
  try {
    root = new Client({ connectionString: ADMIN_URL });
    await root.connect();
  } catch (e) {
    root = null;
    console.log(`\nNOTICE: database tests SKIPPED: no local Postgres could be reached (${(e as Error).message}).`);
    console.log("        The client and parser tests above still ran. Start a local Postgres, or set TEST_PG_URL, to run the rest.\n");
  }
  if (root) {
    const name = `bs_ingest_${process.pid}_${Date.now().toString(36)}`;
    await root.query(`create database ${name}`);
    let db: Client | null = null;
    try {
      db = new Client({ connectionString: withDb(ADMIN_URL, name) });
      await db.connect();
      await db.query(readFileSync("db/local/supabase-shim.sql", "utf8"));
      await migrate(db);
      await databaseTests(db);
    } finally {
      await db?.end().catch(() => {});
      await root.query(`drop database if exists ${name}`).catch((e) => console.log(`could not drop ${name}: ${e.message}`));
      await root.end().catch(() => {});
    }
  }
  if (!finish("ingest tests")) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
