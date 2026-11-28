/** Tests for the pure rules: no network, no database. Run with `npm test`. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InfiniteQueryObserver, QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { Client } from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET as findTestRecipients, POST as changeTestAlert } from "../app/api/admin/test-alerts/route";
import { POST as createApiKey } from "../app/api/admin/api-keys/route";
import { POST as createLegacyApiKey } from "../app/api/admin/pick-api-keys/route";
import { POST as savePick } from "../app/api/admin/pick/route";
import { POST as saveNewsSource } from "../app/api/admin/news-sources/route";
import { GET as loadAdminData } from "../app/api/admin/data/[section]/route";
import { NewsSourceForm } from "../components/admin/NewsSourceForm";
import { adminOptions, adminKey, AdminRequestError, recipientOptions } from "../lib/admin-query";
import {
  categoriesFromAppPrefs,
  derivedToken,
  mergeCandidates,
  newsSourceKey,
  parseSecArchiveUrl,
  secIndexUrl,
  sortCategories,
  summaryKind,
  BASIC_SUMMARY_WHY,
  type Candidate,
} from "../lib/backfill/mapping";
import type { FeedItem } from "../lib/data/feed";
import { parseNewsSourceUpdate } from "../lib/data/news-sources";
import { scheduleTestAlert } from "../lib/alerts/test-alerts";
import { connectionConfig } from "../lib/db/connect";
import { groupInsiderTrades, insiderGroupText } from "../lib/feed-groups";
import { resetPersonalizedFeedCaches, feedKey, feedOptions, liveFeedKey, liveFeedOptions, prependFeed, refreshDiversifiedFeed, summaryOptions, type FeedData, type FeedFilters, type LiveFeed } from "../lib/feed-query";
import { describeTarget, parseArgs } from "../lib/db/target";
import { readMigrations } from "../lib/db/migrate";
import { normalizeTicker, parseTickerFile, tvSymbol } from "../lib/sec/companies";
import { secUserAgent, secUserAgentProblem } from "../lib/sec/user-agent";
import { finish, test } from "./testing";

const cand = (over: Partial<Candidate>): Candidate => ({
  channel: "email", address: "a@example.org", cik: 320193, categories: ["earnings"], cadence: "instant", status: "active",
  confirmToken: null, unsubscribeToken: "t".repeat(32), legacyToken: null, oldTokens: ["t".repeat(32)], consentText: null, consentAt: null, consentIp: null,
  consentUserAgent: null, source: "x", confirmedAt: null, unsubscribedAt: null, createdAt: "2026-06-01T00:00:00.000000Z",
  legacy: { source: "x" }, ...over,
});

const feedPost = (n: number): FeedItem => ({
  id: `n:${n}`, kind: "release", cik: 320193, ticker: "AAPL", company: "Apple", category: "press",
  typeLabel: "Press release", formCode: null, items: [], sourceName: "Test source", headline: `News ${n}`,
  publishedAt: new Date(Date.UTC(2026, 10, 21) + n * 1000).toISOString(), path: `/release/${n}`,
  originalUrl: `https://example.org/${n}`, summary: null, canSummarize: true,
  cursor: `${new Date(Date.UTC(2026, 10, 21) + n * 1000).toISOString()}|n|${n}`,
});

const feedFilters: FeedFilters = { category: "all", mine: false, text: "", limit: 30, accountScope: null };

async function main() {
  console.log("unit tests");

  await test("all staff data endpoints refuse signed-out visitors without caching", async () => {
    const savedDb = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      for (const section of ["session", "counts", "config", "jobs", "inquiries", "list-size", "picks", "scheduled-picks", "test-alerts", "news-sources"]) {
        const response = await loadAdminData(new Request(`http://localhost:3000/api/admin/data/${section}`), {
          params: Promise.resolve({ section }),
        });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
    } finally {
      if (savedDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDb;
    }
  });

  await test("staff queries reuse fresh data, invalidate immediately, and surface refresh failures", async () => {
    const client = new QueryClient();
    const originalFetch = globalThis.fetch;
    let value = 1;
    let status = 200;
    let requests = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/admin/data/list-size");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal instanceof AbortSignal);
      requests++;
      return Response.json(status === 200 ? value : { error: "Unavailable" }, { status });
    };
    const options = adminOptions("list-size");
    const observer = new QueryObserver(client, { ...options, enabled: false, retry: false });
    const passive = new QueryObserver(client, { ...options, enabled: false });
    const unsubscribe = observer.subscribe(() => {});
    const unsubscribePassive = passive.subscribe(() => {});
    try {
      await client.prefetchQuery(options);
      assert.equal(client.getQueryData(adminKey("list-size")), 1);
      value = 2;
      assert.equal(await client.fetchQuery(options), 1, "fresh prefetched data must be reused");
      observer.setOptions({ ...options, retry: false });
      assert.equal(requests, 1, "mounting an active section must not refetch fresh data");
      value = 3;
      await client.invalidateQueries({ queryKey: ["admin"] });
      assert.equal(client.getQueryData(adminKey("list-size")), 3);
      assert.equal(passive.getCurrentResult().data, 3, "read-only consumers receive cache updates");
      assert.equal(requests, 2, "invalidation refetches once, without a request from the passive reader");
      client.setQueryData(adminKey("list-size"), 3, { updatedAt: Date.now() - 16_000 });
      value = 4;
      assert.equal(await client.fetchQuery(options), 4, "stale data must be fetched again");
      status = 503;
      await observer.refetch();
      assert.equal(observer.getCurrentResult().isError, true);
      assert.equal(observer.getCurrentResult().data, 4, "retain last data with an explicit error");
      assert.ok(requests >= 4);
      assert.ok(typeof options.retry === "function");
      assert.equal(options.retry(0, new AdminRequestError("Denied", 403)), false);
      assert.equal(options.retry(0, new AdminRequestError("Signed out", 401)), false);
      for (const opts of [options, recipientOptions("test")]) {
        assert.ok(typeof opts.refetchInterval === "number");
        assert.ok(opts.refetchInterval > 0 && opts.refetchInterval < 60_000);
        assert.equal(opts.refetchIntervalInBackground, true);
        assert.equal(opts.refetchOnWindowFocus, true);
        assert.equal(opts.refetchOnReconnect, true);
      }
    } finally {
      unsubscribe();
      unsubscribePassive();
      client.clear();
      globalThis.fetch = originalFetch;
    }
  });

  await test("test-alert API refuses cross-origin and unauthenticated requests", async () => {
    const savedDb = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const crossOrigin = await changeTestAlert(new Request("http://localhost:3000/api/admin/test-alerts", {
        method: "POST", headers: { origin: "https://other.example" },
      }));
      assert.equal(crossOrigin.status, 403);
      const anonymous = await changeTestAlert(new Request("http://localhost:3000/api/admin/test-alerts", { method: "POST" }));
      assert.equal(anonymous.status, 403);
      assert.equal((await findTestRecipients(new Request("http://localhost:3000/api/admin/test-alerts?q=test"))).status, 403);
      assert.equal((await createApiKey(new Request("http://localhost:3000/api/admin/api-keys", { method: "POST" }))).status, 403);
      assert.equal((await createApiKey(new Request("http://localhost:3000/api/admin/api-keys", {
        method: "POST", headers: { origin: "https://other.example" },
      }))).status, 403);
      assert.equal((await createLegacyApiKey(new Request("http://localhost:3000/api/admin/pick-api-keys", { method: "POST" }))).status, 403);
      assert.equal((await savePick(new Request("http://localhost:3000/api/admin/pick", { method: "POST" }))).status, 403);
      assert.equal((await savePick(new Request("http://localhost:3000/api/admin/pick", {
        method: "POST", headers: { origin: "https://other.example" },
      }))).status, 403);
      assert.equal((await saveNewsSource(new Request("http://localhost:3000/api/admin/news-sources", { method: "POST" }))).status, 403);
      assert.equal((await saveNewsSource(new Request("http://localhost:3000/api/admin/news-sources", {
        method: "POST", headers: { origin: "https://other.example" },
      }))).status, 403);
    } finally {
      if (savedDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDb;
    }
  });

  await test("news source settings require valid flags, a terms note, and keep SEC on", () => {
    const original = { enabled: false, can_store_body: false, can_summarize: false, terms_note: null };
    const settings = { ...original, enabled: true, terms_note: "  Agreement checked  " };
    assert.equal(parseNewsSourceUpdate({ key: "benzinga", settings, original }).settings.terms_note, "Agreement checked");
    assert.throws(() => parseNewsSourceUpdate({ key: "sec", settings, original }), /SEC/);
    assert.throws(() => parseNewsSourceUpdate({ key: "benzinga", settings: { ...settings, terms_note: " " }, original }), /terms note/);
    assert.throws(() => parseNewsSourceUpdate({ key: "benzinga", settings: { ...settings, enabled: "true" }, original }), /Invalid/);
    assert.throws(() => parseNewsSourceUpdate({ key: "INVALID", settings, original }), /Invalid/);
  });

  await test("news source forms keep editable fields with their own save action", () => {
    const source = { key: "benzinga", name: "Benzinga", enabled: true, can_store_body: false, can_summarize: false, terms_note: "Terms checked" };
    const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement("div", null,
        createElement(NewsSourceForm, { source }),
        createElement(NewsSourceForm, { source: { ...source, key: "sec", name: "SEC.gov" } }),
      ),
    ));
    const form = markup.match(/<form\b[\s\S]*?<\/form>/g);
    assert.equal(form?.length, 1);
    assert.equal((form[0].match(/<input\b/g) ?? []).length, 3);
    assert.match(form[0], /<textarea\b/);
    assert.match(form[0], /aria-label="Save Benzinga"/);
    assert.match(markup, /Always on/);
  });

  await test("SEC User-Agent: missing, placeholder and incomplete values are refused", () => {
    assert.match(secUserAgentProblem(undefined)!, /not set/);
    assert.match(secUserAgentProblem("   ")!, /not set/);
    assert.match(secUserAgentProblem("BigStocks admin@yourdomain.com")!, /placeholder/);
    assert.match(secUserAgentProblem("[Company Name] [monitored email]")!, /placeholder/);
    assert.match(secUserAgentProblem("Acme Research LLC")!, /no contact email/);
    assert.match(secUserAgentProblem("ops@acme-research.com")!, /no company name/);
    assert.equal(secUserAgentProblem("Acme Research LLC sec-contact@acme-research.com"), null);
    assert.throws(() => secUserAgent({}), /SEC_USER_AGENT is not set/);
    assert.equal(secUserAgent({ SEC_USER_AGENT: " Acme Research LLC ops@acme-research.com " }), "Acme Research LLC ops@acme-research.com");
  });

  await test("tickers are normalised to BRK.B style", () => {
    assert.equal(normalizeTicker("brk-b"), "BRK.B");
    assert.equal(normalizeTicker(" $aapl "), "AAPL");
    assert.equal(normalizeTicker("BAD TICKER!"), null);
    assert.equal(normalizeTicker(""), null);
    assert.equal(normalizeTicker(null), null);
    assert.equal(normalizeTicker("TOOLONGTICKER"), null);
  });

  await test("TradingView symbols: Nasdaq and OTC get a prefix, NYSE is left for TradingView to resolve", () => {
    assert.equal(tvSymbol("AAPL", "Nasdaq"), "NASDAQ:AAPL");
    assert.equal(tvSymbol("CPLMF", "OTC"), "OTC:CPLMF");
    assert.equal(tvSymbol("BRK.B", "NYSE"), "BRK.B");
    assert.equal(tvSymbol("NOEX", null), null);
  });

  await test("the SEC ticker file: first ticker is the main one, bad lines are skipped and counted", () => {
    const p = parseTickerFile(JSON.parse(readFileSync("scripts/fixtures/company_tickers_exchange.sample.json", "utf8")));
    assert.equal(p.tickers.length, 10);
    assert.equal(p.companies, 8);
    assert.deepEqual(p.skipped.map((s) => s.reason).sort(), ["bad CIK", "bad ticker", "ticker listed twice"]);
    const by = new Map(p.tickers.map((t) => [t.ticker, t]));
    assert.equal(by.get("GOOGL")!.isPrimary, true);
    assert.equal(by.get("GOOG")!.isPrimary, false);
    assert.equal(by.get("BRK.B")!.isPrimary, true);
    assert.equal(by.get("BRK.A")!.cik, 1067983);
    assert.equal(by.get("NOEX")!.exchange, null);
    assert.throws(() => parseTickerFile({ nope: true }), /Not the SEC ticker file/);
    assert.throws(() => parseTickerFile({ fields: ["cik", "name"], data: [] }), /no "ticker" column/);
  });

  await test("SEC archive links give the company and accession numbers; anything else is refused", () => {
    assert.deepEqual(
      parseSecArchiveUrl("https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/aapl-20260627.htm"),
      { cik: 320193, accession: "0000320193-26-000018" },
    );
    assert.deepEqual(
      parseSecArchiveUrl("https://www.sec.gov/Archives/edgar/data/9000001/000900000126000041/0009000001-26-000041-index.htm"),
      { cik: 9000001, accession: "0009000001-26-000041" },
    );
    assert.equal(parseSecArchiveUrl("https://example.com/Archives/edgar/data/1/000000000126000001/x.htm"), null);
    assert.equal(parseSecArchiveUrl("http://www.sec.gov/Archives/edgar/data/1/000000000126000001/x.htm"), null);
    assert.equal(parseSecArchiveUrl("https://www.sec.gov.evil.example/Archives/edgar/data/1/000000000126000001/"), null);
    assert.equal(parseSecArchiveUrl("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent"), null);
    assert.equal(parseSecArchiveUrl(null), null);
    assert.equal(
      secIndexUrl(320193, "0000320193-26-000018"),
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/0000320193-26-000018-index.htm",
    );
  });

  await test("news sources: known wires map to keys, the old sample feed does not", () => {
    assert.equal(newsSourceKey("PR Newswire"), "prnewswire");
    assert.equal(newsSourceKey(" business wire "), "businesswire");
    assert.equal(newsSourceKey("Sample Wire"), null);
    assert.equal(newsSourceKey(null), null);
  });

  await test("derived tokens are stable, different per input, and fit the token rule", () => {
    const a = derivedToken("app-unsubscribe", "tok", 320193);
    assert.equal(a, derivedToken("app-unsubscribe", "tok", 320193));
    assert.notEqual(a, derivedToken("app-unsubscribe", "tok", 789019));
    assert.notEqual(derivedToken("a", "bc"), derivedToken("ab", "c"));
    assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  });

  await test("old app alert switches become categories; 'news' includes press releases", () => {
    assert.deepEqual(categoriesFromAppPrefs({ earnings: true, news: true, insider: false }), ["press", "earnings", "news"]);
    assert.deepEqual(categoriesFromAppPrefs({ insider: true }), ["insider"]);
    assert.deepEqual(categoriesFromAppPrefs(null), []);
    assert.deepEqual(sortCategories(["news", "picks", "news", "bogus"]), ["picks", "news"]);
  });

  await test("old summaries: insider trades and the plain fallback are not labelled as AI", () => {
    assert.equal(summaryKind("4", "Insiders buying..."), "rule");
    assert.equal(summaryKind("10-Q", BASIC_SUMMARY_WHY), "rule");
    assert.equal(summaryKind("10-Q", "Sales grew."), "ai");
    assert.equal(summaryKind("4/A", "Amended."), "ai");
  });

  await test("merging two old records: an opt-out wins unless the sign-up came later", () => {
    const active = cand({ status: "active", createdAt: "2026-02-01T00:00:00.000000Z", categories: ["earnings"] });
    const outLater = cand({ status: "unsubscribed", unsubscribedAt: "2026-05-01T00:00:00.000000Z", unsubscribeToken: "u".repeat(32) });
    const outEarlier = cand({ status: "unsubscribed", unsubscribedAt: "2026-01-01T00:00:00.000000Z", unsubscribeToken: "u".repeat(32) });
    const outUnknown = cand({ status: "unsubscribed", unsubscribedAt: null, unsubscribeToken: "u".repeat(32) });
    assert.equal(mergeCandidates(active, outLater).status, "unsubscribed");
    assert.equal(mergeCandidates(outLater, active).status, "unsubscribed");
    assert.equal(mergeCandidates(active, outEarlier).status, "active");
    assert.equal(mergeCandidates(outEarlier, active).status, "active");
    assert.equal(mergeCandidates(active, outUnknown).status, "unsubscribed", "an opt-out with no date always wins");
    assert.equal(mergeCandidates(outUnknown, outLater).unsubscribedAt, "2026-05-01T00:00:00.000000Z", "keep the opt-out we know more about");
    const lost = mergeCandidates(active, { ...outLater, oldTokens: ["u".repeat(32)] });
    assert.deepEqual(lost.oldTokens.sort(), ["t".repeat(32), "u".repeat(32)], "both records' link codes are kept");
    const kept = (lost.legacy as { merged: { status: string; tokens: string[]; consent: object }[] }).merged;
    assert.deepEqual([kept.length, kept[0].status, kept[0].tokens], [1, "active", ["t".repeat(32)]], "the losing record is kept whole");
    // A third record for the same subscription: nothing from the first two is lost.
    const third = mergeCandidates(lost, cand({ status: "pending", oldTokens: ["v".repeat(32)], legacy: { source: "z" } }));
    assert.deepEqual(third.oldTokens.sort(), ["t".repeat(32), "u".repeat(32), "v".repeat(32)]);
    assert.equal((third.legacy as { merged: unknown[] }).merged.length, 2);
    assert.deepEqual((third.legacy as { sources: string[] }).sources.sort(), ["x", "z"]);
  });

  await test("merging two old records: confirmed beats unconfirmed, older is kept, alert kinds are combined", () => {
    const pending = cand({ status: "pending", categories: ["insider"], createdAt: "2026-01-01T00:00:00.000000Z" });
    const active = cand({ status: "active", categories: ["earnings"], createdAt: "2026-03-01T00:00:00.000000Z" });
    const merged = mergeCandidates(pending, active);
    assert.equal(merged.status, "active");
    assert.deepEqual(merged.categories, ["earnings"], "an unanswered request never widens a confirmed subscription");
    assert.deepEqual(mergeCandidates(active, cand({ status: "active", categories: ["insider"] })).categories, ["earnings", "insider"]);
    // The consent record: the winner's own; when it has none, the other record's.
    const withProof = cand({ status: "pending", consentText: "I agree", consentIp: "203.0.113.7", createdAt: "2026-05-01T00:00:00.000000Z" });
    const bare = cand({ status: "active", createdAt: "2026-01-01T00:00:00.000000Z" });
    assert.deepEqual([mergeCandidates(bare, withProof).consentText, mergeCandidates(bare, withProof).consentIp], ["I agree", "203.0.113.7"]);
    const older = cand({ createdAt: "2026-01-01T00:00:00.000000Z", source: "older" });
    const newer = cand({ createdAt: "2026-02-01T00:00:00.000000Z", source: "newer" });
    assert.equal(mergeCandidates(newer, older).source, "older");
    assert.throws(() => mergeCandidates(cand({}), cand({ address: "other@example.org" })), /same subscription/);
  });

  await test("database connections: a database on another machine is always encrypted; a local one is left alone", () => {
    const none = {} as NodeJS.ProcessEnv;
    assert.equal(connectionConfig("postgres://u:p@localhost:5432/app", none).ssl, undefined);
    assert.equal(connectionConfig("postgresql://u@localhost/app?host=/var/run/postgresql", none).ssl, undefined);
    assert.deepEqual(connectionConfig("postgres://u:p@db.abcdefgh.supabase.co:5432/postgres", none).ssl, { rejectUnauthorized: false });
    // The address says how itself: left exactly as written.
    assert.equal(connectionConfig("postgres://u:p@db.example.com/x?sslmode=verify-full", none).ssl, undefined);
    assert.equal(connectionConfig("postgres://u:p@db.example.com/x?sslmode=disable", none).ssl, undefined);
    // With the provider's certificate file, the server is checked against it.
    const checked = connectionConfig("postgres://u:p@db.example.com/x", { DATABASE_SSL_CA: "package.json" } as unknown as NodeJS.ProcessEnv).ssl as { ca: string; rejectUnauthorized: boolean };
    assert.equal(checked.rejectUnauthorized, true);
    assert.ok(checked.ca.includes("bigstocks-web"));
    assert.throws(() => connectionConfig("postgres://u:p@db.example.com/x", { DATABASE_SSL_CA: "/no/such/file.crt" } as unknown as NodeJS.ProcessEnv), /could not be read/);
  });

  await test("insider trades: a burst from one company becomes one row; everything else keeps its place", () => {
    const post = (id: string, cik: number, category: FeedItem["category"], minutesAgo: number, headline = "Director received 100 shares"): FeedItem => ({
      id, kind: "filing", cik, ticker: `T${cik}`, company: `Company ${cik}`, category, typeLabel: "x", formCode: null, items: [], sourceName: "SEC.gov",
      headline, publishedAt: new Date(Date.UTC(2026, 10, 13, 18, 0) - minutesAgo * 60_000).toISOString(), path: `/filing/${id}`, originalUrl: "https://www.sec.gov/x",
      summary: null, canSummarize: true, cursor: id,
    });
    const list = [
      post("a", 1, "insider", 1, "Director bought 300 shares"),
      post("b", 1, "insider", 2, "Chief Executive Officer sold 5,000 shares"),
      post("c", 2, "earnings", 3),
      post("d", 1, "insider", 4),
      post("e", 3, "insider", 5),
      post("f", 1, "insider", 200), // the same company, hours earlier: a separate report, not part of the burst
      post("g", 1, "news", 201),
    ];
    const grouped = groupInsiderTrades(list);
    assert.deepEqual(grouped.map((e) => (e.kind === "item" ? e.item.id : e.items.map((i) => i.id).join("+"))), ["a+b+d", "c", "e", "f", "g"]);
    const burst = grouped[0];
    assert.ok(burst.kind === "insiders");
    assert.deepEqual(insiderGroupText(burst.items), {
      headline: "3 insiders reported trades",
      breakdown: "1 bought on the open market · 1 sold on the open market · 1 through awards or other transfers",
      detail: "1 bought on the open market · 1 sold on the open market · 1 through awards or other transfers. Open to see each one.",
    });
    assert.equal(insiderGroupText([list[3], list[3]]).detail, "All through stock awards or other transfers, not open-market trades. Open to see each one.");
    assert.deepEqual(groupInsiderTrades([]), []);
    // Nothing is lost or repeated.
    assert.equal(grouped.reduce((n, e) => n + (e.kind === "item" ? 1 : e.items.length), 0), list.length);
  });

  await test("feed cache: server data is reused, older pages keep their cursor, and filters and accounts are isolated", async () => {
    const client = new QueryClient();
    const originalFetch = globalThis.fetch;
    const calls: URL[] = [];
    globalThis.fetch = async (input) => {
      calls.push(new URL(String(input), "http://localhost"));
      return Response.json({ items: [feedPost(1)], next: null, latestCursor: feedPost(1).cursor, hasMore: false });
    };
    try {
      const initial = { items: [feedPost(3), feedPost(2)], next: feedPost(2).cursor };
      const options = feedOptions(feedFilters, initial);
      await client.fetchInfiniteQuery(options);
      assert.equal(calls.length, 0, "the server-rendered first page needs no duplicate request");
      const observer = new InfiniteQueryObserver(client, options);
      await observer.fetchNextPage();
      assert.equal(calls[0].searchParams.get("before"), feedPost(2).cursor);
      const data = client.getQueryData<FeedData>(feedKey(feedFilters))!;
      const fresh = { items: [feedPost(4), feedPost(3)], latestCursor: feedPost(4).cursor, next: null };
      client.setQueryData(feedKey(feedFilters), prependFeed(data, fresh));
      const merged = client.getQueryData<FeedData>(feedKey(feedFilters))!;
      assert.deepEqual(merged.pages.flatMap((page) => page.items.map((item) => item.id)), ["n:4", "n:3", "n:2", "n:1"]);
      assert.equal(merged.pages[0].next, feedPost(2).cursor);
      assert.deepEqual(merged.pageParams, [null, feedPost(2).cursor]);
      await client.fetchInfiniteQuery(feedOptions({ ...feedFilters, category: "press" }));
      await client.fetchInfiniteQuery(feedOptions(feedFilters, initial));
      assert.equal(calls.length, 2, "switching back reuses every loaded page");
      assert.equal(client.getQueryData(feedKey({ ...feedFilters, text: "Apple" })), undefined);
      assert.equal(client.getQueryData(feedKey({ ...feedFilters, limit: 60 })), undefined);
      const mine = { ...feedFilters, mine: true, accountScope: "account-a" };
      client.setQueryData(feedKey(mine), merged);
      assert.equal(client.getQueryData(feedKey({ ...mine, accountScope: "account-b" })), undefined);
    } finally {
      globalThis.fetch = originalFetch;
      client.clear();
    }
  });

  await test("follow changes reset personalized feed caches without clearing general feeds", async () => {
    const client = new QueryClient();
    const mine = { ...feedFilters, mine: true, accountScope: "account-a" };
    const feedData: FeedData = { pages: [{ items: [feedPost(1)], next: null }], pageParams: [null] };
    const liveData: LiveFeed = { items: [feedPost(2)], latestCursor: feedPost(2).cursor, next: null };
    const refreshedFeed: FeedData = { pages: [{ items: [feedPost(3)], next: null }], pageParams: [null] };
    const refreshedLive: LiveFeed = { items: [feedPost(4)], latestCursor: feedPost(4).cursor, next: null };
    client.setQueryData(feedKey(mine), feedData);
    client.setQueryData(liveFeedKey(mine), liveData);
    client.setQueryData(["feed-refresh", mine], feedData.pages[0]);
    client.setQueryData(feedKey(feedFilters), feedData);
    const feedObserver = new QueryObserver(client, {
      queryKey: feedKey(mine), queryFn: async () => refreshedFeed, staleTime: Infinity, retry: false,
    });
    const liveObserver = new QueryObserver(client, {
      queryKey: liveFeedKey(mine), queryFn: async () => refreshedLive, staleTime: Infinity, retry: false,
    });
    const unsubscribeFeed = feedObserver.subscribe(() => {});
    const unsubscribeLive = liveObserver.subscribe(() => {});

    try {
      await resetPersonalizedFeedCaches(client);

      assert.deepEqual(client.getQueryData(feedKey(mine)), refreshedFeed);
      assert.deepEqual(client.getQueryData(liveFeedKey(mine)), refreshedLive);
      assert.equal(client.getQueryData(["feed-refresh", mine]), undefined);
      assert.equal(client.getQueryData(feedKey(feedFilters)), feedData, "non-personalized feed data is retained");
    } finally {
      unsubscribeFeed();
      unsubscribeLive();
      client.clear();
    }
  });

  await test("scheduled alerts reject calendar-invalid timestamps that JavaScript normalizes", async () => {
    await assert.rejects(scheduleTestAlert(new Client(), "user-id", {
      subject: "Delivery check",
      body: "This is a test.",
      scheduledAt: "2099-02-30T12:00:00Z",
      recipients: ["1"],
      confirm: true,
    }), /Choose a time in the future/);
  });

  await test("live feed: a 65-post burst catches up immediately without refreshing older pages or losing buffered posts", async () => {
    const client = new QueryClient();
    const originalFetch = globalThis.fetch;
    const calls: URL[] = [];
    const displayed: FeedData = { pages: [{ items: [feedPost(1)], next: "older-cursor" }], pageParams: [null] };
    client.setQueryData(feedKey(feedFilters), displayed);
    globalThis.fetch = async (input) => {
      const url = new URL(String(input), "http://localhost");
      calls.push(url);
      const after = url.searchParams.get("after");
      const remaining = Array.from({ length: 65 }, (_, index) => feedPost(index + 2)).filter((item) => item.cursor > (after ?? ""));
      const items = remaining.slice(0, 30).reverse();
      return Response.json({ items, next: null, latestCursor: items[0]?.cursor ?? null, hasMore: remaining.length > 30 });
    };
    try {
      const updates = await client.fetchQuery(liveFeedOptions(client, feedFilters));
      assert.equal(calls.length, 3);
      assert.deepEqual(calls.map((url) => url.searchParams.get("after")), [feedPost(1).cursor, feedPost(31).cursor, feedPost(61).cursor]);
      assert.ok(calls.every((url) => !url.searchParams.has("before")));
      assert.equal(updates.items.length, 65);
      assert.equal(updates.latestCursor, feedPost(66).cursor);
      assert.equal(client.getQueryData(feedKey(feedFilters)), displayed, "posts stay behind the show-new-posts bar");
      await client.invalidateQueries({ queryKey: liveFeedKey(feedFilters), exact: true });
      const repeated = await client.fetchQuery(liveFeedOptions(client, feedFilters));
      assert.equal(repeated.items.length, 65, "an empty check does not clear buffered posts");
      assert.equal(new Set(repeated.items.map((item) => item.id)).size, 65);
      const merged = prependFeed(displayed, repeated);
      assert.equal(merged.pages[0].items.length, 66);
      assert.equal(merged.pages[0].next, "older-cursor");
    } finally {
      globalThis.fetch = originalFetch;
      client.clear();
    }
  });

  await test("live feed: an initially empty list retains the cursor for older posts when new posts are shown", async () => {
    const client = new QueryClient();
    const originalFetch = globalThis.fetch;
    const displayed: FeedData = { pages: [{ items: [], next: null }], pageParams: [null] };
    client.setQueryData(feedKey(feedFilters), displayed);
    globalThis.fetch = async () => Response.json({
      items: [feedPost(3), feedPost(2)], next: feedPost(2).cursor, latestCursor: feedPost(3).cursor, hasMore: true,
    });
    try {
      const updates = await client.fetchQuery(liveFeedOptions(client, feedFilters));
      const merged = prependFeed(displayed, updates);
      assert.equal(merged.pages[0].next, feedPost(2).cursor);
      assert.deepEqual(merged.pages[0].items.map((item) => item.id), ["n:3", "n:2"]);
    } finally {
      globalThis.fetch = originalFetch;
      client.clear();
    }
  });

  await test("live feed: refreshing the diversified feed resets pagination and advances the live cursor", async () => {
    const client = new QueryClient();
    const originalFetch = globalThis.fetch;
    const old: FeedData = { pages: [{ items: [feedPost(3)], next: "old" }, { items: [feedPost(1)], next: null }], pageParams: [null, "old"] };
    const pending: LiveFeed = { items: [feedPost(4)], latestCursor: feedPost(4).cursor, next: null };
    client.setQueryData(feedKey(feedFilters), old);
    client.setQueryData(liveFeedKey(feedFilters), pending);
    globalThis.fetch = async (input) => {
      const url = new URL(String(input), "http://localhost");
      assert.equal(url.searchParams.has("after"), false);
      assert.equal(url.searchParams.has("before"), false);
      return Response.json({ items: [feedPost(5), feedPost(2)], next: "new", latestCursor: feedPost(5).cursor, hasMore: true });
    };
    try {
      await refreshDiversifiedFeed(client, feedFilters);
      const data = client.getQueryData<FeedData>(feedKey(feedFilters))!;
      assert.deepEqual(data.pages.map((page) => page.items.map((item) => item.id)), [["n:5", "n:2"]]);
      assert.deepEqual(data.pageParams, [null]);
      assert.equal(data.pages[0].next, "new");
      assert.deepEqual(client.getQueryData<LiveFeed>(liveFeedKey(feedFilters)), { items: [], latestCursor: feedPost(5).cursor, next: "new" });

      globalThis.fetch = async () => Response.json({}, { status: 503 });
      await assert.rejects(refreshDiversifiedFeed(client, feedFilters), /not available/);
      assert.equal(client.getQueryData(feedKey(feedFilters)), data);
    } finally {
      globalThis.fetch = originalFetch;
      client.clear();
    }
  });

  await test("feed requests: failed updates retain good data and cancelling an obsolete search aborts its fetch", async () => {
    const client = new QueryClient();
    const originalFetch = globalThis.fetch;
    const displayed: FeedData = { pages: [{ items: [feedPost(1)], next: null }], pageParams: [null] };
    const previous: LiveFeed = { items: [feedPost(2)], latestCursor: feedPost(2).cursor, next: null };
    client.setQueryData(feedKey(feedFilters), displayed);
    client.setQueryData(liveFeedKey(feedFilters), previous);
    globalThis.fetch = async () => Response.json({ items: [], next: null, error: "Unavailable" }, { status: 503 });
    try {
      await client.invalidateQueries({ queryKey: liveFeedKey(feedFilters), exact: true });
      await assert.rejects(client.fetchQuery({ ...liveFeedOptions(client, feedFilters), retry: false }), /not available/);
      assert.deepEqual(client.getQueryData(liveFeedKey(feedFilters)), previous);
      assert.equal(client.getQueryData(feedKey(feedFilters)), displayed);
      const search = { ...feedFilters, text: "obsolete" };
      let signal: AbortSignal | null | undefined;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => { started = resolve; });
      globalThis.fetch = async (_input, init) => {
        signal = init?.signal;
        started();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      };
      const pending = client.fetchInfiniteQuery({ ...feedOptions(search), retry: false });
      const rejected = assert.rejects(pending);
      await ready;
      await client.cancelQueries({ queryKey: feedKey(search), exact: true });
      await rejected;
      assert.ok(signal?.aborted);
      assert.equal(client.getQueryData(feedKey(search)), undefined);
    } finally {
      globalThis.fetch = originalFetch;
      client.clear();
    }
  });

  await test("summary queries: pending results can become ready and a ready summary is reused without another request", async () => {
    const client = new QueryClient();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    const ready = { status: "ready", headline: "Results improved", summary: { kind: "ai", oneSentence: "Sales grew.", bullets: [] } };
    globalThis.fetch = async () => Response.json(++calls === 1 ? { status: "pending" } : ready);
    try {
      const options = summaryOptions("n:1");
      assert.deepEqual(await client.fetchQuery(options), { status: "pending" });
      await client.invalidateQueries({ queryKey: options.queryKey, exact: true });
      assert.deepEqual(await client.fetchQuery(options), ready);
      assert.deepEqual(await client.fetchQuery(options), ready);
      assert.equal(calls, 2);
      assert.equal(client.getQueryData(summaryOptions("n:2").queryKey), undefined);
    } finally {
      globalThis.fetch = originalFetch;
      client.clear();
    }
  });

  await test("database targets: local is recognised, passwords never appear in the label", () => {
    assert.equal(describeTarget("postgresql://u@localhost/app?host=/var/run/postgresql").isLocal, true);
    assert.equal(describeTarget("postgres://u:secret@127.0.0.1:5432/app").isLocal, true);
    const remote = describeTarget("postgres://postgres:hunter2@db.abcdefgh.supabase.co:5432/postgres");
    assert.equal(remote.isLocal, false);
    assert.ok(!remote.label.includes("hunter2"));
    assert.throws(() => describeTarget("not a url"), /not a valid URL/);
    // A string that could go to two places is local only if both are.
    assert.equal(describeTarget("postgresql://u@localhost/db?host=/var/run/postgresql&host=db.prod.example.com", {} as NodeJS.ProcessEnv).isLocal, false);
    assert.equal(describeTarget("postgresql://u@db.prod.example.com/db?host=/var/run/postgresql", {} as NodeJS.ProcessEnv).isLocal, false);
    assert.equal(describeTarget("postgresql:///db", { PGHOST: "db.prod.example.com" } as unknown as NodeJS.ProcessEnv).isLocal, false);
    assert.equal(describeTarget("postgresql:///db", {} as NodeJS.ProcessEnv).isLocal, true);
    assert.equal(describeTarget("postgresql://u@[::1]/db", {} as NodeJS.ProcessEnv).isLocal, true);
  });

  await test("command-line arguments", () => {
    const spec = { flags: ["dry-run", "yes"], values: ["only", "report"] };
    const a = parseArgs(["--dry-run", "--only", "users,news", "--report=out.json", "--yes"], spec);
    assert.deepEqual([...a.flags].sort(), ["dry-run", "yes"]);
    assert.equal(a.values.get("only"), "users,news");
    assert.equal(a.values.get("report"), "out.json");
    // A slip must never turn a rehearsal into a real run.
    assert.throws(() => parseArgs(["--dryrun", "--yes"], spec), /Unknown option --dryrun/);
    assert.throws(() => parseArgs(["--dry-run=true", "--yes"], spec), /takes no value/);
    assert.throws(() => parseArgs(["--only"], spec), /needs a value/);
    assert.deepEqual(parseArgs(["--dry-run", "out.json", "--yes"], spec).rest, ["out.json"]);
    assert.ok(parseArgs(["--dry-run", "out.json", "--yes"], spec).flags.has("dry-run"));
  });

  await test("migration files are named and ordered correctly", () => {
    const all = readMigrations();
    assert.ok(all.length >= 19);
    assert.deepEqual(all.map((m) => m.version), [...all.map((m) => m.version)].sort());
  });

  if (!finish("unit tests")) process.exit(1);
}

main();
