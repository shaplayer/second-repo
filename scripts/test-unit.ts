/** Tests for the pure rules: no network, no database. Run with `npm test`. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeCandidates, type Candidate } from "../lib/backfill/mapping";
import { normalizeTicker, parseTickerFile, tvSymbol } from "../lib/sec/companies";
import { createCompanySearch, parseCompanyDirectory, parseCompanyResponse, resolveCompanyTicker, type Company } from "../lib/search/companies";
import { finish, test } from "./testing";

const cand = (over: Partial<Candidate>): Candidate => ({
  channel: "email", address: "a@example.org", cik: 320193, categories: ["earnings"], cadence: "instant", status: "active",
  confirmToken: null, unsubscribeToken: "t".repeat(32), legacyToken: null, consentText: null, consentAt: null, consentIp: null,
  consentUserAgent: null, source: "x", confirmedAt: null, unsubscribedAt: null, createdAt: "2026-06-01T00:00:00.000000Z",
  legacy: { source: "x" }, ...over,
});

async function main() {
  console.log("unit tests");

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

  const searchCompanies: Company[] = [
    { cik: 320193, ticker: "AAPL", name: "Apple Inc.", exchange: "Nasdaq" },
    { cik: 1, ticker: "APLE", name: "Apple Hospitality REIT", exchange: "NYSE" },
    { cik: 789019, ticker: "MSFT", name: "Microsoft Corporation", exchange: "Nasdaq" },
    { cik: 1067983, ticker: "BRK.B", name: "Berkshire Hathaway Inc.", exchange: "NYSE" },
    ...Array.from({ length: 10 }, (_, n) => ({
      cik: 100 + n, ticker: `Z${n}`, name: `Apple Example ${n}`, exchange: null,
    })),
  ];

  await test("company search ranks exact tickers first and supports prefixes, multiple words and typos", () => {
    const search = createCompanySearch(searchCompanies);
    assert.equal(search.search("$aapl")[0].ticker, "AAPL");
    assert.equal(search.search("brk-b")[0].ticker, "BRK.B");
    assert.equal(search.search("micro")[0].ticker, "MSFT");
    assert.deepEqual(search.search("apple hospital").map((c) => c.ticker), ["APLE"]);
    assert.equal(search.search("microsft")[0].ticker, "MSFT");
    assert.equal(search.search("apple").length, 8);
    assert.deepEqual(search.search(""), []);
    assert.deepEqual(search.search("not-a-real-company"), []);
    assert.equal(resolveCompanyTicker("FDA", search), null);
    assert.equal(resolveCompanyTicker("aapl", search), "AAPL");
    assert.equal(resolveCompanyTicker("$aapl"), "AAPL");
    assert.equal(resolveCompanyTicker("$invalid ticker"), null);
  });

  await test("company directory rejects malformed and empty responses", () => {
    assert.throws(() => parseCompanyDirectory({ fields: [], data: [] }), /no "cik" column/);
    assert.throws(() => parseCompanyDirectory({ fields: ["cik", "name", "ticker", "exchange"], data: [] }), /no valid tickers/);
    assert.deepEqual(parseCompanyDirectory({
      fields: ["ticker", "exchange", "name", "cik"],
      data: [["BRK-B", "NYSE", "Berkshire Hathaway Inc.", 1067983]],
    }), [searchCompanies[3]]);
    assert.throws(() => parseCompanyResponse({ companies: [], stale: false }), /Invalid company directory/);
    assert.throws(() => parseCompanyResponse({ companies: searchCompanies }), /Invalid company directory/);
    assert.throws(() => parseCompanyResponse({ companies: [{ ...searchCompanies[0], cik: "320193" }], stale: false }), /Invalid company directory/);
    assert.deepEqual(parseCompanyResponse({ companies: searchCompanies, stale: true }), { companies: searchCompanies, stale: true });
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
    const lost = mergeCandidates(active, outLater);
    assert.deepEqual((lost.legacy as { other_tokens: string[] }).other_tokens, ["t".repeat(32)], "the losing record's token is kept");
  });

  await test("merging two old records: confirmed beats unconfirmed, older is kept, alert kinds are combined", () => {
    const pending = cand({ status: "pending", categories: ["insider"], createdAt: "2026-01-01T00:00:00.000000Z" });
    const active = cand({ status: "active", categories: ["earnings"], createdAt: "2026-03-01T00:00:00.000000Z" });
    const merged = mergeCandidates(pending, active);
    assert.equal(merged.status, "active");
    assert.deepEqual(merged.categories, ["earnings", "insider"]);
    const older = cand({ createdAt: "2026-01-01T00:00:00.000000Z", source: "older" });
    const newer = cand({ createdAt: "2026-02-01T00:00:00.000000Z", source: "newer" });
    assert.equal(mergeCandidates(newer, older).source, "older");
    assert.throws(() => mergeCandidates(cand({}), cand({ address: "other@example.org" })), /same subscription/);
  });

  if (!finish("unit tests")) process.exit(1);
}

main();
