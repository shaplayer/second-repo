/** Tests for the pure rules: no network, no database. Run with `npm test`. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

async function main() {
  console.log("unit tests");

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

  await test("migration files are named and ordered correctly, and the old ones are untouched", () => {
    const all = readMigrations();
    assert.ok(all.length >= 19);
    assert.deepEqual(all.map((m) => m.version), [...all.map((m) => m.version)].sort());
    for (const m of all.filter((x) => x.version <= "20261014004200")) {
      const original = readFileSync(`legacy/vercel-app/supabase/migrations/${m.file}`, "utf8");
      assert.equal(m.sql, original, `${m.file} must stay exactly as the old app applied it`);
    }
  });

  if (!finish("unit tests")) process.exit(1);
}

main();
