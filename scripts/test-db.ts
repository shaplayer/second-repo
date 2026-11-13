/**
 * Database tests for the unified schema, the company loader and the copy from the two old databases.
 *
 * It creates two throwaway databases on a LOCAL Postgres, fills them with made-up data shaped like the
 * old app and the old data site, runs the real migrations and scripts, checks the results, and drops
 * both databases. It refuses to run against anything that is not local.
 *
 *   npm run test:db                 # fails if there is no local Postgres
 *   tsx scripts/test-db.ts --if-available   # skips (with a notice) when there is none; used by `npm test`
 *
 * TEST_PG_URL may point at a local server's maintenance database
 * (default: postgresql://<you>@localhost/postgres?host=/var/run/postgresql).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";
import { Client } from "pg";
import { recordBackfillRun, runBackfill, type BackfillReport, type StepReport } from "../lib/backfill/run";
import { BASIC_SUMMARY_WHY, derivedToken } from "../lib/backfill/mapping";
import { loadCompanies } from "../lib/db/companies";
import { migrate, readMigrations } from "../lib/db/migrate";
import { describeTarget } from "../lib/db/target";
import { parseTickerFile, type TickerRow } from "../lib/sec/companies";
import { finish, test } from "./testing";

const ADMIN_URL =
  process.env.TEST_PG_URL ??
  `postgresql://${encodeURIComponent(process.env.PGUSER ?? os.userInfo().username)}@localhost/postgres?host=/var/run/postgresql`;
const LAST_OLD_MIGRATION = "20261014004200";
/** How many migration files are newer than the old app's seven. */
const NEWER = readMigrations().filter((m) => m.version > LAST_OLD_MIGRATION).length;

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const U3 = "00000000-0000-4000-8000-000000000003";
const U4 = "00000000-0000-4000-8000-000000000004";
const TOK = (name: string) => (name + "_" + "x".repeat(32)).slice(0, 32);
// Deliberately awkward: an em dash, an accent, a tick, double spaces, a newline and trailing spaces.
const CONSENT_2 = "By checking this box, I agree — café ✓  to texts.\n(Second line)  ";

const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = "/" + name;
  return u.toString();
};

async function connect(url: string): Promise<Client> {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

const rowsOf = async <T extends Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[];
const one = async <T extends Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []) => (await rowsOf<T>(c, sql, params))[0];
const num = async (c: Client, sql: string, params: unknown[] = []) => Number(Object.values((await one(c, sql, params)) ?? { n: NaN })[0]);

async function seedOldApp(c: Client) {
  await c.query(`insert into auth.users (id, email) values ($1, 'alice@example.org'), ($2, 'bob@example.org'), ($3, 'carol@example.org')`, [U1, U2, U3]);
  await c.query(`update public.profiles set display_name = 'Alice' where id = $1`, [U1]);
  await c.query(`update public.profiles set display_name = 'Bob', chat_banned = true where id = $1`, [U2]);
  await c.query(
    `insert into public.watchlist (user_id, ticker, added_at) values
       ($1, 'AAPL', '2026-10-01T10:00:00Z'), ($1, 'BRK.B', '2026-10-01T11:00:00Z'), ($1, 'ZZZZ', '2026-10-01T12:00:00Z'),
       ($2, 'GOOG', '2026-10-02T10:00:00Z'), ($2, 'GOOGL', '2026-10-03T10:00:00Z')`,
    [U1, U2],
  );
  const prefs = (o: object) => JSON.stringify({ earnings: true, news: true, insider: false, picks: false, mode: "instant", ...o });
  await c.query(
    `insert into public.alert_subscribers (id, email, token, confirmed, tickers, prefs, created_at) values
       ('10000000-0000-4000-8000-000000000001', 'alice@example.org', $1, true,  '{AAPL,MSFT}', $7, '2026-09-01T00:00:00Z'),
       ('10000000-0000-4000-8000-000000000002', 'dave@example.org',  $2, false, '{AAPL}',      $8, '2026-09-02T00:00:00Z'),
       ('10000000-0000-4000-8000-000000000003', 'erin@example.org',  $3, true,  '{ZZZZ}',      $9, '2026-09-03T00:00:00Z'),
       ('10000000-0000-4000-8000-000000000004', 'frank@example.org', $4, true,  '{}',          $9, '2026-09-04T00:00:00Z'),
       ('10000000-0000-4000-8000-000000000005', 'both@example.org',  $5, true,  '{AAPL}',      $9, '2026-08-01T00:00:00Z'),
       ('10000000-0000-4000-8000-000000000006', 'later@example.org', $6, true,  '{MSFT}',      $9, '2026-10-20T00:00:00Z')`,
    [TOK("alice"), TOK("dave"), TOK("erin"), TOK("frank"), TOK("both"), TOK("later"),
      prefs({ picks: true }), prefs({ news: false, insider: true, mode: "daily" }), prefs({})],
  );
  const sec = "https://www.sec.gov/Archives/edgar/data";
  await c.query(
    `insert into public.filing_summaries
       (accession, ticker, company_name, form, accepted, url, headline, bullets, why_it_matters, tone, importance, category, created_at) values
       ('0000320193-26-000018', 'AAPL', 'Apple Inc.', '10-Q', '2026-07-30T20:05:11.123456Z', '${sec}/320193/000032019326000018/aapl-20260627.htm',
        'Sales rose 6%', '{"Sales were $94 billion."}', 'Steady growth.', 'Good news', 'High', 'earnings', '2026-07-30T20:10:00Z'),
       ('0000320193-26-000020', 'AAPL', 'Apple Inc.', '4', '2026-08-03T21:00:00Z', '${sec}/320193/000032019326000020/form4.xml',
        'Director bought 1,000 shares', '{"Who: Jane (Director)."}', 'Insiders buying is often read as confidence.', 'Good news', 'Low', 'insider', '2026-08-03T21:01:00Z'),
       ('0000789019-26-000007', 'MSFT', 'MICROSOFT CORP', '8-K', '2026-08-04T12:00:00Z', '${sec}/789019/000078901926000007/msft-8k.htm',
        'Important company news', '{"An official announcement."}', $1, 'Routine', 'Medium', 'news', '2026-08-04T12:01:00Z'),
       ('0009999999-26-000001', 'ZZZZ', 'Zed Corp', '8-K', '2026-08-05T12:00:00Z', 'https://example.com/filing.htm',
        'Example', '{"x"}', 'y', 'Routine', 'Low', 'news', '2026-08-05T12:01:00Z'),
       ('0000789019-26-000099', 'MSFT', 'MICROSOFT CORP', '10-K', '2026-08-06T12:00:00Z', '${sec}/789019/000078901926000008/msft-10k.htm',
        'Annual report', '{"x"}', 'y', 'Routine', 'High', 'earnings', '2026-08-06T12:01:00Z'),
       ('0001234567-26-000001', 'PRIV', 'Private Newco Inc', 'S-1', '2026-08-07T03:30:00Z', '${sec}/1234567/000123456726000001/s1.htm',
        'Files to go public', '{"x"}', 'y', 'Routine', 'High', 'news', '2026-08-07T03:31:00Z')`,
    [BASIC_SUMMARY_WHY],
  );
  await c.query(
    `insert into public.picks (ticker, company_name, kind, title, why, author, tier, price_at_post, owns_shares, ownership_note, sponsor) values
       ('AAPL', 'Apple Inc.', 'pick', 'Why Apple', 'Because.', 'Sam', 'free', 190.5, true, 'Owns 10 shares', null),
       ('MSFT', 'MICROSOFT CORP', 'sponsored', 'Sponsored: Microsoft', 'Paid post.', 'BigStocks', 'members', 400, false, '',
        '{"payer":"Acme IR","amount":"$5,000","form":"cash"}')`,
  );
}

async function seedOldSite(c: Client) {
  const t = (n: number) => String(n).repeat(32).slice(0, 32).replace(/[^a-f0-9]/g, "a");
  await c.query(
    `insert into subscribers
       (id, email, phone, sms_consent, consent_text, consent_at, ip, user_agent, source, created_at, unsubscribed_at, general_alerts, unsub_token) values
       (1,  'gina@example.org',     null,           false, null, null, '203.0.113.7', 'Mozilla/5.0 (Test)', 'home', '2026-05-01T10:00:00.111111Z', null, true, $2),
       (2,  null,                   '+15555550101', true,  $1,   '2026-03-01T12:34:56.123456Z', 'unknown', 'Mozilla/5.0 (iPhone; "quoted")', 'home-hero', '2026-03-01T12:34:56.123456Z', null, true, $3),
       (3,  'harry@example.org',    null,           false, null, null, '203.0.113.8', null, 'home', '2026-04-01T00:00:00Z', null, false, $4),
       (4,  'follower@example.org', null,           false, null, null, '203.0.113.9', null, 'follow', '2026-06-01T00:00:00Z', null, false, $5),
       (5,  null,                   '+15555550102', true,  'Consent text five', '2026-02-01T00:00:00.000001Z', '198.51.100.5', null, 'home', '2026-02-01T00:00:00Z', '2026-06-15T08:00:00.654321Z', true, $6),
       (6,  'both@example.org',     null,           false, null, null, null, null, 'follow', '2026-07-01T00:00:00Z', null, false, $7),
       (7,  'later@example.org',    null,           false, null, null, null, null, 'follow', '2025-12-01T00:00:00Z', null, false, $8),
       (8,  null,                   '+15555550103', false, null, null, null, null, 'home', '2026-01-01T00:00:00Z', null, true, $9),
       (9,  'UPPER@Example.org',    null,           false, null, null, null, null, 'home', '2026-01-02T00:00:00Z', null, true, $10),
       (10, 'not an email',         null,           false, null, null, null, null, 'home', '2026-01-03T00:00:00Z', null, true, $11),
       (11, 'combo@example.org',    '+15555550104', true,  'Combo consent', '2026-01-04T01:02:03.000004Z', '2001:db8::1, 10.0.0.1', 'UA', 'import', '2026-01-04T00:00:00Z', null, true, $12),
       (12, 'alice@example.org',    null,           false, null, null, '203.0.113.12', null, 'home-footer', '2026-01-05T00:00:00Z', null, true, $13)`,
    [CONSENT_2, t(1), t(2), t(3), t(4), t(5), t(6), t(7), t(8), t(9), "d0".repeat(16), "e1".repeat(16), "f2".repeat(16)],
  );
  await c.query(
    `insert into ticker_follows (id, subscriber_id, ticker, channel, token, consent_text, consent_at, confirmed_at, unsubscribed_at, created_at) values
       (1, 4, 'AAPL',  'email', $1, null, null, '2026-06-01T00:05:00Z', null, '2026-06-01T00:00:00Z'),
       (2, 4, 'MSFT',  'email', $2, null, null, null, null, '2026-06-02T00:00:00Z'),
       (3, 2, 'AAPL',  'sms',   $3, 'Follow consent for $AAPL — exact', '2026-03-02T09:08:07.000009Z', '2026-03-02T09:08:07.000009Z', null, '2026-03-02T09:08:07.000009Z'),
       (4, 5, 'MSFT',  'sms',   $4, 'Follow consent MSFT', '2026-02-02T00:00:00Z', '2026-02-02T00:00:00Z', null, '2026-02-02T00:00:00Z'),
       (5, 6, 'AAPL',  'email', $5, null, null, '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-07-01T00:00:00Z'),
       (6, 7, 'MSFT',  'email', $6, null, null, '2025-12-01T00:00:00Z', '2026-01-01T00:00:00Z', '2025-12-01T00:00:00Z'),
       (7, 4, 'CPLMF', 'email', $7, null, null, '2026-06-03T00:00:00Z', null, '2026-06-03T00:00:00Z'),
       (8, 4, 'NOPE',  'email', $8, null, null, '2026-06-04T00:00:00Z', null, '2026-06-04T00:00:00Z'),
       (9, 4, 'BRK-B', 'email', $9, null, null, '2026-06-05T00:00:00Z', null, '2026-06-05T00:00:00Z')`,
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => TOK("follow" + n)),
  );
  const sec = "https://www.sec.gov/Archives/edgar/data";
  await c.query(
    `insert into news_items (kind, ticker, company, title, url, source, form_type, published_at) values
       ('filing', 'AAPL', 'Apple Inc.', 'Apple Inc.: Current report', '${sec}/320193/000032019326000030/0000320193-26-000030-index.htm', 'SEC EDGAR', '8-K', '2026-11-04T22:38:02Z'),
       ('filing', 'NWBT', 'Northwind', 'Northwind: sample', 'https://example.com/filings/1', 'SEC EDGAR', '8-K', '2026-11-04T22:00:00Z'),
       ('filing', 'HGRD', 'Halcyon', 'Halcyon: Quarterly report', '${sec}/9000002/000900000226000107/0009000002-26-000107-index.htm', 'SEC EDGAR', '10-Q', '2026-11-03T21:00:00Z'),
       ('filing', 'XXXX', 'Unlisted Co', 'Unlisted: Annual', '${sec}/7777777/000777777726000001/0007777777-26-000001-index.htm', 'SEC EDGAR', null, '2026-11-02T00:00:00Z'),
       ('press', 'AAPL', 'Apple', 'Apple announces something', 'https://www.prnewswire.com/news-releases/apple-123.html', 'PR Newswire', null, '2026-11-05T13:00:00Z'),
       ('press', 'TSXX', 'Maple Corp', 'Maple Corp reports', 'https://www.businesswire.com/news/home/20261105000001/en/', 'Business Wire', null, '2026-11-05T12:00:00Z'),
       ('press', 'NWBT', 'Northwind', 'Sample press item', 'https://example.com/press/1', 'Sample Wire', null, '2026-11-05T11:00:00Z'),
       ('press', 'MSFT', 'Microsoft', 'Old http link', 'http://www.prnewswire.com/news-releases/msft-1.html', 'PR Newswire', null, '2026-11-05T10:00:00Z')`,
  );
  await c.query(
    `insert into alerts (id, ticker, alerted_at, alert_price, high_after, close_after, result, sponsored, sponsor_comp, notes, tier, message) values
       (1, 'AAPL',  '2026-10-01T12:15:00.250000Z', 12.3400, 13.0, 12.9, 'win', false, null, 'note', 'free', 'Breaking out'),
       (2, 'CPLMF', '2026-10-02T12:15:00Z', 0.4500, null, null, null, true, 'BigStocks was paid $2,500 in cash by Copperline Minerals for this alert.', null, 'free', null),
       (3, 'MSFT',  '2026-10-03T12:15:00Z', 400, null, null, 'open', true, '', null, 'free', null),
       (4, 'NOPE',  '2026-10-04T12:15:00Z', 1.5, null, null, null, false, null, null, 'premium', 'Premium idea')`,
  );
  await c.query(
    `insert into broadcasts (id, alert_id, tier, channels, subject, text_body, html_body, sms_body, status, email_cursor, sms_cursor, emails_sent, texts_sent, failed, finished_at) values
       (1, 1, 'free', '{email,sms}', 'BigStocks Alert: $AAPL', 'text {{UNSUB}}', '<p>html</p>', 'sms', 'done', 12, 5, 3, 2, 0, '2026-10-01T12:20:00Z'),
       (2, 2, 'free', '{email}', 'BigStocks Alert: $CPLMF', 't', 'h', '', 'sending', 4, 0, 4, 0, 0, null)`,
  );
  await c.query(
    `insert into inquiries (id, name, company, ticker, email, phone, package, message, ip, created_at, handled_at, notified_at) values
       (1, 'Ivy', 'Copperline Minerals', 'CPLMF', 'ivy@example.org', '+15555550999', 'Sponsored alert', 'Hello', '203.0.113.50', '2026-09-01T00:00:00Z', null, '2026-09-01T00:01:00Z'),
       (2, 'Jon', 'Halcyon', 'HGRD', 'jon@example.org', null, null, null, null, '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z', null)`,
  );
}

type Sub = {
  id: string; channel: string; address: string; cik: string | null; categories: string[]; cadence: string; status: string;
  confirm_token: string | null; unsubscribe_token: string; legacy_token: string | null; consent_text: string | null; consent_at: string | null;
  consent_ip: string | null; consent_user_agent: string | null; source: string | null; unsubscribed_at: string | null; created: string;
  legacy: Record<string, unknown>;
};
const SUB_SQL = `select id::text as id, channel, address, cik::text as cik, categories, cadence, status, confirm_token, unsubscribe_token,
    legacy_token, consent_text, to_char(consent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as consent_at, consent_ip,
    consent_user_agent, source, to_char(unsubscribed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as unsubscribed_at,
    to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created, legacy
  from public.alert_subscriptions`;

/** Everything in the new tables except the two timestamps that legitimately move on every run. */
async function snapshot(c: Client): Promise<string> {
  const parts: string[] = [];
  for (const [table, cols, order] of [
    ["users", "*", "id"], ["watchlists", "user_id, cik, added_at", "user_id, cik"], ["filings", "*", "accession"],
    ["summaries", "*", "id"], ["news", "*", "id"], ["picks", "*", "posted_at, id"], ["broadcasts", "*", "id"], ["inquiries", "*", "id"],
    ["companies", "cik, ticker, name, exchange, tv_symbol", "cik"], ["company_tickers", "*", "ticker"],
  ] as const) {
    const { rows } = await c.query(`select ${cols} from public.${table} order by ${order}`);
    parts.push(table + ":" + JSON.stringify(rows));
  }
  const subs = await rowsOf(c, `${SUB_SQL} order by channel, address, cik`);
  parts.push("alert_subscriptions:" + JSON.stringify(subs));
  return parts.join("\n");
}

async function main() {
  const admin = describeTarget(ADMIN_URL);
  if (!admin.isLocal) throw new Error(`Database tests only run against a local Postgres. TEST_PG_URL points at ${admin.host}.`);
  let root: Client;
  try {
    root = await connect(ADMIN_URL);
  } catch (e) {
    if (process.argv.includes("--if-available")) {
      console.log(`database tests SKIPPED: no local Postgres at ${admin.label} (${(e as Error).message}). Run npm run test:db where one is available.`);
      return;
    }
    throw new Error(`No local Postgres at ${admin.label}: ${(e as Error).message}`);
  }
  const appDb = `bs_test_app_${process.pid}`;
  const siteDb = `bs_test_site_${process.pid}`;
  await root.query(`create database ${appDb}`);
  await root.query(`create database ${siteDb}`);
  const app = await connect(withDb(ADMIN_URL, appDb));
  const site = await connect(withDb(ADMIN_URL, siteDb));
  await app.query("set client_min_messages = warning");
  console.log(`database tests (local Postgres, throwaway databases ${appDb} and ${siteDb})`);

  const fixture = parseTickerFile(JSON.parse(readFileSync("scripts/fixtures/company_tickers_exchange.sample.json", "utf8")));
  let report!: BackfillReport;
  const step = (name: string): StepReport => report.steps.find((s) => s.step === name)!;
  const subs = async () => new Map((await rowsOf<Sub>(app, SUB_SQL)).map((s) => [`${s.channel}|${s.address}|${s.cik ?? ""}`, s]));
  const backfill = async (opts: Parameters<typeof runBackfill>[2] = {}) => {
    await app.query("begin");
    await site.query("begin transaction isolation level repeatable read read only");
    try {
      const r = await runBackfill(app, site, opts);
      await app.query("commit");
      return r;
    } catch (e) {
      await app.query("rollback");
      throw e;
    } finally {
      await site.query("rollback");
    }
  };

  try {
    /* ---------------------------------------------------------- migrations */
    await test("the old app's migrations apply, then the new ones apply on top of real rows", async () => {
      await app.query(readFileSync("db/local/supabase-shim.sql", "utf8"));
      const first = await migrate(app, { upTo: LAST_OLD_MIGRATION });
      assert.equal(first.applied.length, 7);
      await seedOldApp(app);
      const second = await migrate(app);
      assert.equal(second.applied.length, NEWER);
      assert.equal(second.alreadyApplied, 7);
      const third = await migrate(app);
      assert.equal(third.applied.length, 0, "running again changes nothing");
      assert.equal(third.alreadyApplied, 7 + NEWER);
    });

    await test("a failing migration is rolled back completely", async () => {
      const dir = `${os.tmpdir()}/bs-bad-migration-${process.pid}`;
      const fs = await import("node:fs");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/20990101000000_bad.sql`, "create table public.half_done (id int); select 1/0;");
      await assert.rejects(migrate(app, { dir }), /failed and was rolled back/);
      assert.equal(await num(app, `select count(*) from pg_tables where tablename = 'half_done'`), 0);
      assert.equal(await num(app, `select count(*) from supabase_migrations.schema_migrations where version = '20990101000000'`), 0);
      fs.rmSync(`${dir}/20990101000000_bad.sql`);
      fs.rmdirSync(dir);
    });

    await test("--baseline marks older files as applied without running them", async () => {
      const name = `bs_test_base_${process.pid}`;
      await root.query(`create database ${name}`);
      const c = await connect(withDb(ADMIN_URL, name));
      try {
        const r = await migrate(c, { baseline: LAST_OLD_MIGRATION, dryRun: true });
        assert.equal(r.baselined.length, 7);
        assert.equal(r.pending.length, NEWER);
        const made = await one<{ made: boolean }>(c, `select to_regclass('supabase_migrations.schema_migrations') is not null as made`);
        assert.equal(made.made, false, "a dry run creates and records nothing");
      } finally {
        await c.end();
        await root.query(`drop database ${name}`);
      }
    });

    await test("old picks survive the picks change; a new sign-up gets a row in both account tables", async () => {
      assert.equal(await num(app, `select count(*) from public.picks`), 2);
      await app.query(`insert into auth.users (id, email) values ($1, 'dan@example.org')`, [U4]);
      assert.equal(await num(app, `select count(*) from public.profiles where id = $1`, [U4]), 1);
      assert.equal(await num(app, `select count(*) from public.users where id = $1 and email = 'dan@example.org'`, [U4]), 1);
      // The old app is still live: a sign-up there must go through even when that address already has an account here.
      await app.query(`insert into public.users (email) values ('eve@example.org')`);
      await app.query(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000005', 'eve@example.org')`);
      assert.equal(await num(app, `select count(*) from public.profiles where email = 'eve@example.org'`), 1);
      assert.equal(await num(app, `select count(*) from public.users where lower(email) = 'eve@example.org'`), 1);
      await app.query(`delete from auth.users where email = 'eve@example.org'`);
      await app.query(`delete from public.users where email = 'eve@example.org'`);
    });

    /* ---------------------------------------------------------- constraints */
    const refuses = async (sql: string, why: RegExp, params: unknown[] = []) => {
      await app.query("savepoint s");
      try {
        await assert.rejects(app.query(sql, params), why);
      } finally {
        await app.query("rollback to savepoint s");
      }
    };

    await test("the database itself refuses bad data", async () => {
      await app.query("begin");
      try {
        await app.query(`insert into public.companies (cik, ticker, name) values (1, 'TEST', 'Test Co')`);
        await refuses(`insert into public.companies (cik, ticker, name) values (2, 'test', 'Lower')`, /companies_ticker_check/);
        await refuses(
          `insert into public.filings (accession, cik, form, accepted_at, filed_date, primary_url, index_url)
           values ('0000000001-26-000001', 1, '8-K', now(), current_date, 'https://example.com/a', 'https://www.sec.gov/Archives/x')`,
          /filings_primary_url_check/,
        );
        await refuses(
          `insert into public.filings (accession, cik, form, accepted_at, filed_date, primary_url, index_url)
           values ('1-26-1', 1, '8-K', now(), current_date, 'https://www.sec.gov/Archives/a', 'https://www.sec.gov/Archives/x')`,
          /filings_accession_check/,
        );
        await refuses(
          `insert into public.news (source, title, url, published_at) values ('sec', 'x', 'https://example.com/press/1', now())`,
          /news_sec_rows_point_at_sec/,
        );
        await refuses(
          `insert into public.news (source, title, url, published_at) values ('prnewswire', 'x', 'http://www.prnewswire.com/x', now())`,
          /news_url_check/,
        );
        await refuses(
          `insert into public.news (source, title, url, published_at) values ('samplewire', 'x', 'https://example.com/x', now())`,
          /news_source_fkey/,
        );
        await refuses(
          `insert into public.picks (ticker, company_name, kind, title, why, author, tier) values ('TEST', 'Test Co', 'sponsored', 't', 'w', 'a', 'free')`,
          /sponsored_needs_disclosure/,
        );
        await refuses(
          `insert into public.picks (ticker, company_name, kind, title, why, author, tier, disclosure_text) values ('TEST', 'Test Co', 'sponsored', 't', 'w', 'a', 'free', 'paid')`,
          /sponsored_needs_disclosure/,
        );
        await refuses(`delete from public.picks`, /Picks cannot be deleted/);
        const sub = `insert into public.alert_subscriptions (channel, address, cik, unsubscribe_token) values`;
        await app.query(`${sub} ('email', 'x@example.org', null, $1)`, ["a".repeat(32)]);
        await refuses(`${sub} ('email', 'x@example.org', null, $1)`, /alert_subscriptions_one_per_address_and_company/, ["b".repeat(32)]);
        await refuses(`${sub} ('email', 'X@Example.org', 1, $1)`, /alert_subscriptions_address_shape/, ["c".repeat(32)]);
        await refuses(`${sub} ('sms', '5555550101', 1, $1)`, /alert_subscriptions_address_shape/, ["d".repeat(32)]);
        await refuses(`${sub} ('email', 'y@example.org', 1, 'short')`, /alert_subscriptions_unsubscribe_token_check/);
        await refuses(
          `insert into public.alert_subscriptions (channel, address, cik, unsubscribe_token, categories) values ('email', 'z@example.org', 1, $1, '{stocks}')`,
          /alert_subscriptions_categories_check/, ["e".repeat(32)],
        );
        const id = await num(app, `select id from public.alert_subscriptions where address = 'x@example.org'`);
        await app.query(`insert into public.alert_events (subscription_id, item_type, item_ref, dedupe_key) values ($1, 'pick', 'p1', 'pick:p1')`, [id]);
        await refuses(
          `insert into public.alert_events (subscription_id, item_type, item_ref, dedupe_key) values ($1, 'pick', 'p1', 'pick:p1')`,
          /alert_events_once_per_person_per_item/, [id],
        );
        await refuses(
          `insert into public.summaries (accession, news_id, kind, prompt_version, headline, bullets, tone, importance, category, source_url)
           values (null, null, 'rule', 1, 'h', '{}', 't', 'i', 'c', 'https://www.sec.gov/x')`,
          /summaries_one_subject/,
        );
        await refuses(
          `insert into public.fundamentals_snapshots (cik, as_of, quarters, ttm, verdict, rule_set) values (1, current_date, '[]', '{}', 'Weak', 'lenient')`,
          /fundamentals_snapshots_rule_set_check/,
        );
        await refuses(
          `insert into public.fundamentals_snapshots (cik, as_of, quarters, ttm, verdict) values (1, current_date, '[]', '{}', 'Buy')`,
          /fundamentals_snapshots_verdict_check/,
        );
        await refuses(
          `insert into public.fundamentals_snapshots (cik, as_of, quarters, ttm) values (1, current_date, '[]', '{}')`,
          /fundamentals_snapshots_check/,
        );
      } finally {
        await app.query("rollback");
      }
    });

    /* ------------------------------------------------------- company loader */
    const load = async (rows: TickerRow[], opts: { prune?: boolean } = {}) => {
      await app.query("begin");
      try {
        const r = await loadCompanies(app, rows, opts);
        await app.query("commit");
        return r;
      } catch (e) {
        await app.query("rollback");
        throw e;
      }
    };

    await test("the company list loads; a second load changes nothing", async () => {
      const r = await load(fixture.tickers);
      assert.equal(r.companiesAdded, 8);
      assert.equal(r.tickersAdded, 10);
      const again = await load(fixture.tickers);
      assert.deepEqual([again.companiesAdded, again.companiesChanged, again.tickersAdded], [0, 0, 0]);
      const brk = await one<{ ticker: string; tv_symbol: string; exchange: string }>(app, `select ticker, tv_symbol, exchange from public.companies where cik = 1067983`);
      assert.deepEqual(brk, { ticker: "BRK.B", tv_symbol: "BRK.B", exchange: "NYSE" });
      assert.equal((await one<{ tv_symbol: string }>(app, `select tv_symbol from public.companies where ticker = 'AAPL'`)).tv_symbol, "NASDAQ:AAPL");
      assert.equal(await num(app, `select cik from public.company_tickers where ticker = 'GOOG'`), 1652044);
    });

    await test("a ticker that moves to another company, and a changed main ticker, load without tripping the unique rules", async () => {
      const name = `bs_test_co_${process.pid}`;
      await root.query(`create database ${name} template ${appDb}`).catch(async () => {
        // The template is in use by our own connection: build the same state by hand instead.
        await root.query(`create database ${name}`);
      });
      const c = await connect(withDb(ADMIN_URL, name));
      try {
        if (!(await num(c, `select count(*) from pg_tables where schemaname = 'public' and tablename = 'companies'`))) {
          await c.query(readFileSync("db/local/supabase-shim.sql", "utf8"));
          await migrate(c);
          await c.query("begin");
          await loadCompanies(c, fixture.tickers);
          await c.query("commit");
        }
        // Halcyon's ticker goes to Northwind, Northwind's old ticker becomes Halcyon's, and Alphabet's main ticker flips.
        const moved = fixture.tickers.map((t) => ({ ...t }));
        const by = new Map(moved.map((t) => [t.ticker, t]));
        const [h, n] = [by.get("HGRD")!, by.get("NWBT")!];
        [h.cik, n.cik] = [n.cik, h.cik];
        [h.name, n.name] = [n.name, h.name];
        by.get("GOOGL")!.isPrimary = false;
        by.get("GOOG")!.isPrimary = true;
        await c.query("begin");
        const r = await loadCompanies(c, moved);
        await c.query("commit");
        assert.equal(r.tickersMoved, 2);
        assert.equal(await num(c, `select cik from public.companies where ticker = 'HGRD'`), 9000001);
        assert.equal(await num(c, `select cik from public.companies where ticker = 'NWBT'`), 9000002);
        assert.equal((await one<{ ticker: string }>(c, `select ticker from public.companies where cik = 1652044`)).ticker, "GOOG");
        assert.equal(await num(c, `select count(*) from public.company_tickers where cik = 1652044 and is_primary`), 1);
        await c.query("begin");
        await assert.rejects(loadCompanies(c, moved, { prune: true }), /Refusing to prune/);
        await c.query("rollback");
      } finally {
        await c.end();
        await root.query(`drop database ${name}`);
      }
    });

    /* --------------------------------------------------------------- copy */
    await test("the copy refuses to run before the company list is loaded", async () => {
      const name = `bs_test_empty_${process.pid}`;
      await root.query(`create database ${name}`);
      const c = await connect(withDb(ADMIN_URL, name));
      try {
        await c.query(readFileSync("db/local/supabase-shim.sql", "utf8"));
        await migrate(c);
        await assert.rejects(runBackfill(c, null), /must run inside a transaction/);
        await c.query("begin");
        await assert.rejects(runBackfill(c, null), /company list is empty/);
        await c.query("rollback");
      } finally {
        await c.end();
        await root.query(`drop database ${name}`);
      }
    });

    await test("a dry run reports the counts and saves nothing", async () => {
      await site.query(readFileSync("db/schema.sql", "utf8"));
      await seedOldSite(site);
      const before = await snapshot(app);
      await app.query("begin");
      await site.query("begin transaction isolation level repeatable read read only");
      const r = await runBackfill(app, site, { cutover: true });
      await app.query("rollback");
      await site.query("rollback");
      assert.ok(r.ok, JSON.stringify(r.checks.filter((c) => !c.ok)));
      assert.ok(r.steps.find((s) => s.step === "subscriptions")!.inserted > 0);
      assert.equal(await snapshot(app), before);
    });

    await test("first run, three rows at a time: every old row is read once and every check passes", async () => {
      // Tiny pages on purpose: ids 10, 11 and 12 sort before 2 as text, which is how a paging mistake hides.
      report = await backfill({ batchSize: 3 });
      assert.ok(report.ok, JSON.stringify(report.checks.filter((c) => !c.ok)));
      const read = Object.fromEntries(report.checks.filter((c) => c.name.endsWith("every old row was read")).map((c) => [c.name.split(":")[0], c.detail]));
      assert.deepEqual(read, {
        "filings from the data site's feed": "4 of 4", "press releases": "4 of 4", "data-site subscribers": "12 of 12",
        "data-site follows": "9 of 9", "advertiser inquiries": "2 of 2",
      });
      assert.equal(step("subscriptions").source, 6 + 12 + 9);
      assert.equal(step("picks").ran, false);
      assert.equal(step("broadcasts").ran, false);
      assert.equal(await num(app, `select count(*) from public.picks`), 2, "the table the old app still reads is untouched");
      assert.equal(await num(app, `select count(*) from public.broadcasts`), 0);
    });

    await test("accounts: every profile copied, chat name and ban kept, admin flag off", async () => {
      assert.equal(step("users").source, 4);
      const u = await rowsOf<{ email: string; display_name: string | null; chat_banned: boolean; is_admin: boolean }>(
        app, `select email, display_name, chat_banned, is_admin from public.users order by email`);
      assert.deepEqual(u, [
        { email: "alice@example.org", display_name: "Alice", chat_banned: false, is_admin: false },
        { email: "bob@example.org", display_name: "Bob", chat_banned: true, is_admin: false },
        { email: "carol@example.org", display_name: null, chat_banned: false, is_admin: false },
        { email: "dan@example.org", display_name: null, chat_banned: false, is_admin: false },
      ]);
    });

    await test("watchlists: tickers become companies; two tickers of one company count once; unknown tickers are reported", async () => {
      const w = await rowsOf<{ email: string; cik: string }>(
        app, `select u.email, w.cik::text as cik from public.watchlists w join public.users u on u.id = w.user_id order by 1, 2`);
      assert.deepEqual(w, [
        { email: "alice@example.org", cik: "1067983" }, { email: "alice@example.org", cik: "320193" }, { email: "bob@example.org", cik: "1652044" },
      ]);
      const s = step("watchlists");
      assert.equal(s.skipped["ticker not in the company list"], 1);
      assert.equal(s.skipped["same company under two tickers (kept once)"], 1);
      assert.ok(s.notes.join(" ").includes("ZZZZ"));
      const kept = await one<{ added: string }>(app, `select to_char(added_at at time zone 'UTC', 'YYYY-MM-DD') as added from public.watchlists where cik = 1652044`);
      assert.equal(kept.added, "2026-10-02", "the earlier of the two dates is kept");
    });

    await test("filings: only links into the SEC archive are copied; the example.com rows are refused", async () => {
      const f = await rowsOf<{ accession: string; cik: string; form: string; filed: string }>(
        app, `select accession, cik::text as cik, form, filed_date::text as filed from public.filings order by accession`);
      assert.deepEqual(f.map((x) => x.accession), [
        "0000320193-26-000018", "0000320193-26-000020", "0000320193-26-000030", "0000789019-26-000007", "0001234567-26-000001", "0009000002-26-000107",
      ]);
      const s = step("filings");
      assert.equal(s.skipped["summary whose link is not in the SEC archive"], 1);
      assert.equal(s.skipped["summary whose link is for a different filing"], 1);
      assert.equal(s.skipped["feed item whose link is not in the SEC archive"], 1);
      assert.equal(s.skipped["feed item with no form type"], 1);
      assert.equal(await num(app, `select count(*) from public.filings where primary_url not like 'https://www.sec.gov/Archives/%'`), 0);
      // 03:30 UTC on Aug 7 is still Aug 6 in New York.
      assert.equal(f.find((x) => x.accession === "0001234567-26-000001")!.filed, "2026-08-06");
      const exact = await one<{ t: string }>(app, `select to_char(accepted_at at time zone 'UTC', 'HH24:MI:SS.US') as t from public.filings where accession = '0000320193-26-000018'`);
      assert.equal(exact.t, "20:05:11.123456", "times keep their microseconds");
      const co = await one<{ name: string; ticker: string | null }>(app, `select name, ticker from public.companies where cik = 1234567`);
      assert.deepEqual(co, { name: "Private Newco Inc", ticker: null }, "a company without a ticker gets a row so its filing has a home");
    });

    await test("summaries: AI ones name the model; insider trades and the plain fallback are not labelled as AI", async () => {
      const s = await rowsOf<{ accession: string; kind: string; model: string | null; prompt_version: number; source_url: string }>(
        app, `select accession, kind, model, prompt_version, source_url from public.summaries order by accession`);
      assert.deepEqual(s.map((x) => [x.accession, x.kind, x.model]), [
        ["0000320193-26-000018", "ai", "claude-opus-5-5"], ["0000320193-26-000020", "rule", null],
        ["0000789019-26-000007", "rule", null], ["0001234567-26-000001", "ai", "claude-opus-5-5"],
      ]);
      assert.ok(s.every((x) => x.prompt_version === 1 && x.source_url.startsWith("https://www.sec.gov/Archives/")));
      assert.equal(step("summaries").skipped["no filing row (its link was not usable; see the filings step)"], 2);
    });

    await test("news: newswire headlines are copied with their source; the sample feed and http links are not", async () => {
      const n = await rowsOf<{ source: string; ticker: string; cik: string | null; body_text: string | null; url: string }>(
        app, `select source, ticker, cik::text as cik, body_text, url from public.news order by published_at desc`);
      assert.deepEqual(n.map((x) => [x.source, x.ticker, x.cik]), [["prnewswire", "AAPL", "320193"], ["businesswire", "TSXX", null]]);
      assert.ok(n.every((x) => x.body_text === null), "no newswire text is stored");
      const s = step("news");
      assert.equal(s.skipped["source we do not recognise"], 1);
      assert.equal(s.skipped["link is not https"], 1);
      assert.ok(s.notes.join(" ").includes("Sample Wire"));
      assert.equal(await num(app, `select count(*) from public.news where url like '%example.com%'`), 0);
    });

    await test("subscriptions: the right people, the right status", async () => {
      const m = await subs();
      const status = (k: string) => m.get(k)?.status ?? "(missing)";
      const expected: Record<string, string> = {
        "email|alice@example.org|320193": "active", "email|alice@example.org|789019": "active", "email|alice@example.org|": "active",
        "email|dave@example.org|320193": "pending",
        "email|both@example.org|320193": "unsubscribed",   // opted out on the data site after signing up on the app
        "email|later@example.org|789019": "active",        // signed up on the app after opting out on the data site
        "email|gina@example.org|": "active", "sms|+15555550101|": "active",
        "email|harry@example.org|": "unsubscribed",        // used the unsubscribe link (no time recorded)
        "sms|+15555550102|": "unsubscribed",               // replied STOP
        "email|upper@example.org|": "active", "email|combo@example.org|": "active", "sms|+15555550104|": "active",
        "email|follower@example.org|320193": "active", "email|follower@example.org|789019": "pending",
        "sms|+15555550101|320193": "active",
        "sms|+15555550102|789019": "unsubscribed",         // STOP ends every text subscription for that number
        "email|follower@example.org|9000003": "active", "email|follower@example.org|1067983": "active",
      };
      assert.deepEqual(Object.fromEntries([...m.keys()].sort().map((k) => [k, status(k)])), Object.fromEntries(Object.keys(expected).sort().map((k) => [k, expected[k]])));
      const s = step("subscriptions");
      assert.deepEqual(s.skipped, {
        "ticker not in the company list": 2,
        "person with nothing to follow": 2,
        "follows companies only: was never on the general list": 3,
        "phone with no consent to texts": 1,
        "address is not a valid email": 1,
        "same subscription on both old sites (merged into one)": 3,
      });
      assert.ok(s.notes.join(" ").includes("NOPE") && s.notes.join(" ").includes("ZZZZ"));
    });

    await test("subscriptions: consent wording, time, IP and browser are copied character for character", async () => {
      const m = await subs();
      const p = m.get("sms|+15555550101|")!;
      assert.equal(p.consent_text, CONSENT_2);
      assert.equal(p.consent_at, "2026-03-01T12:34:56.123456Z");
      assert.equal(p.consent_ip, "unknown", "an IP that is not an IP is kept as recorded");
      assert.equal(p.consent_user_agent, 'Mozilla/5.0 (iPhone; "quoted")');
      assert.equal(p.source, "home-hero");
      assert.equal(m.get("sms|+15555550104|")!.consent_ip, "2001:db8::1, 10.0.0.1");
      const f = m.get("sms|+15555550101|320193")!;
      assert.equal(f.consent_text, "Follow consent for $AAPL — exact");
      assert.equal(f.consent_at, "2026-03-02T09:08:07.000009Z");
      assert.equal(m.get("sms|+15555550102|")!.unsubscribed_at, "2026-06-15T08:00:00.654321Z", "the STOP time is kept to the microsecond");
      assert.equal(m.get("sms|+15555550102|789019")!.unsubscribed_at, "2026-06-15T08:00:00.654321Z");
      const check = report.checks.find((c) => c.name === "Consent records copied exactly")!;
      assert.ok(check.ok && /19 compared/.test(check.detail), check.detail);
      // Compare straight across the two databases as well, byte for byte.
      const old = await one<{ md5: string; len: number }>(site, `select md5(consent_text) as md5, octet_length(consent_text) as len from subscribers where id = 2`);
      const now = await one<{ md5: string; len: number }>(app, `select md5(consent_text) as md5, octet_length(consent_text) as len from public.alert_subscriptions where address = '+15555550101' and cik is null`);
      assert.deepEqual(now, old);
    });

    await test("subscriptions: links already sent by the old sites still find their rows", async () => {
      const m = await subs();
      assert.equal(m.get("email|gina@example.org|")!.unsubscribe_token, "1".repeat(32), "the main-list unsubscribe link");
      assert.equal(m.get("email|follower@example.org|320193")!.unsubscribe_token, TOK("follow1"), "a follow's unsubscribe link");
      const pending = m.get("email|follower@example.org|789019")!;
      assert.equal(pending.confirm_token, TOK("follow2"), "a confirmation email that is still unanswered");
      assert.equal(m.get("email|follower@example.org|320193")!.confirm_token, null);
      // The old app used one token per person for every link: both of Alice's company rows answer to it.
      const alice = await rowsOf<{ cik: string }>(app, `select cik::text as cik from public.alert_subscriptions where legacy_token = $1 order by cik`, [TOK("alice")]);
      assert.deepEqual(alice.map((x) => x.cik), ["320193", "789019"]);
      assert.equal(m.get("email|alice@example.org|320193")!.unsubscribe_token, derivedToken("app-unsubscribe", TOK("alice"), 320193));
      const dave = m.get("email|dave@example.org|320193")!;
      assert.equal(dave.confirm_token, derivedToken("app-confirm", TOK("dave"), 320193));
      const all = [...m.values()];
      assert.equal(new Set(all.map((x) => x.unsubscribe_token)).size, all.length, "every row has its own unsubscribe token");
    });

    await test("subscriptions: alert kinds and timing carry over", async () => {
      const m = await subs();
      assert.deepEqual(m.get("email|alice@example.org|320193")!.categories, ["press", "earnings", "news"]);
      assert.deepEqual(m.get("email|dave@example.org|320193")!.categories, ["earnings", "insider"]);
      assert.equal(m.get("email|dave@example.org|320193")!.cadence, "digest");
      assert.deepEqual(m.get("email|follower@example.org|320193")!.categories, ["picks", "press", "earnings", "news"]);
      assert.deepEqual(m.get("email|gina@example.org|")!.categories, ["picks"]);
      const alice = m.get("email|alice@example.org|")!;
      assert.equal(alice.created, "2026-01-05T00:00:00.000000Z", "of two sign-ups for the same list, the older is kept");
      assert.equal((alice.legacy as { source: string }).source, "data-site:subscribers");
      assert.ok((alice.legacy as { merged_with?: object }).merged_with, "the other record is kept inside it");
      const later = m.get("email|later@example.org|789019")!;
      assert.equal((later.legacy as { source: string }).source, "app:alert_subscribers");
      assert.deepEqual((later.legacy as { other_tokens: string[] }).other_tokens, [TOK("follow6"), TOK("follow6")]);
    });

    await test("nothing in either old database was changed", async () => {
      assert.equal(await num(app, `select count(*) from public.profiles`), 4);
      assert.equal(await num(app, `select count(*) from public.alert_subscribers`), 6);
      assert.equal(await num(app, `select count(*) from public.filing_summaries`), 6);
      assert.equal(await num(app, `select count(*) from public.watchlist`), 5);
      assert.equal(await num(site, `select count(*) from subscribers`), 12);
      assert.equal(await num(site, `select count(*) from ticker_follows`), 9);
      assert.equal(await num(site, `select count(*) from news_items`), 8);
      await site.query("begin transaction isolation level repeatable read read only");
      await assert.rejects(site.query(`delete from news_items`), /read-only transaction/);
      await site.query("rollback");
    });

    /* ------------------------------------------------------------ run again */
    await test("second run: nothing new, nothing different", async () => {
      const before = await snapshot(app);
      report = await backfill();
      assert.ok(report.ok, JSON.stringify(report.checks.filter((c) => !c.ok)));
      for (const s of report.steps.filter((x) => x.ran)) assert.equal(s.inserted, 0, `${s.step} copied rows again`);
      assert.equal(step("subscriptions").refreshed, 19);
      assert.equal(await snapshot(app), before);
    });

    await test("a row the new site has changed is left alone; one the old site has since removed stops receiving", async () => {
      // On the new site, Gina unsubscribes and Alice switches her Apple alerts to a daily summary.
      await app.query(`update public.alert_subscriptions set status = 'unsubscribed', unsubscribed_at = now() where address = 'gina@example.org'`);
      await app.query(`update public.alert_subscriptions set cadence = 'digest' where address = 'alice@example.org' and cik = 320193`);
      // On the old app, Dave unsubscribes (the old app deletes its record) and Alice drops Microsoft.
      await app.query(`delete from public.alert_subscribers where email = 'dave@example.org'`);
      await app.query(`update public.alert_subscribers set tickers = '{AAPL}' where email = 'alice@example.org'`);
      await app.query(`delete from public.watchlist where ticker = 'BRK.B'`);
      report = await backfill();
      assert.ok(report.ok, JSON.stringify(report.checks.filter((c) => !c.ok)));
      const m = await subs();
      assert.equal(m.get("email|gina@example.org|")!.status, "unsubscribed", "the old data must not switch her back on");
      assert.equal(m.get("email|alice@example.org|320193")!.cadence, "digest");
      assert.equal(step("subscriptions").leftAlone, 2);
      assert.equal(m.get("email|dave@example.org|320193")!.status, "unsubscribed");
      assert.equal(m.get("email|alice@example.org|789019")!.status, "unsubscribed");
      assert.ok(step("subscriptions").notes.join(" ").includes("Marked 2 copied subscriptions as unsubscribed"));
      assert.equal(await num(app, `select count(*) from public.watchlists where cik = 1067983`), 0);
      // And a third run does not flip anything back.
      report = await backfill();
      const again = await subs();
      assert.equal(again.get("email|dave@example.org|320193")!.status, "unsubscribed");
      assert.equal(again.get("email|gina@example.org|")!.status, "unsubscribed");
    });

    await test("without the data-site database, only the old app's rows are touched and nobody is switched off", async () => {
      const before = await subs();
      await app.query("begin");
      const r = await runBackfill(app, null);
      await app.query("commit");
      assert.ok(r.ok, JSON.stringify(r.checks.filter((c) => !c.ok)));
      const after = await subs();
      // Status, consent record, tokens: every row is exactly as it was. In particular the address that opted
      // out on the data site is not switched back on just because the old app still lists it.
      assert.deepEqual([...after].sort(), [...before].sort());
      assert.equal(after.get("email|both@example.org|320193")!.status, "unsubscribed");
      const s = r.steps.find((x) => x.step === "subscriptions")!;
      assert.equal(s.skipped["built partly from an old database that was not read in this run (left as it is)"], 3);
      assert.deepEqual([s.inserted, s.refreshed, s.leftAlone], [0, 0, 1]);
      assert.equal(r.steps.find((x) => x.step === "news")!.ran, false);
    });

    await test("an opt-out on an old site still applies to a row changed here, unless the person confirmed again later", async () => {
      const on = (address: string, cik: number | null) =>
        `address = '${address}' and cik ${cik === null ? "is null" : `= ${cik}`}`;
      // 1. Changed here (daily summary), then opted out on the old site with a recorded time.
      await app.query(`update public.alert_subscriptions set cadence = 'digest' where ${on("follower@example.org", 320193)}`);
      await site.query(`update ticker_follows set unsubscribed_at = '2026-11-10T08:09:10.111213Z' where id = 1`);
      // 2. Opted out on the old site, then confirmed again here afterwards.
      await site.query(`update ticker_follows set unsubscribed_at = '2026-11-10T00:00:00Z' where id = 7`);
      await app.query(`update public.alert_subscriptions set confirmed_at = '2026-11-11T00:00:00Z' where ${on("follower@example.org", 9000003)}`);
      // 3. Changed here, then left the general list by the old unsubscribe link, which records no time.
      await app.query(`update public.alert_subscriptions set cadence = 'digest' where ${on("upper@example.org", null)}`);
      await site.query(`update subscribers set general_alerts = false where id = 9`);
      // 4. The same with no time, but this person confirmed here after the copy; their untouched phone row has no such excuse.
      await site.query(`update subscribers set general_alerts = false where id = 11`);
      await app.query(`update public.alert_subscriptions set confirmed_at = now() where ${on("combo@example.org", null)}`);
      // 5. Still waiting to confirm a new sign-up here: left for the confirmation link to decide.
      await app.query(`update public.alert_subscriptions set status = 'pending', confirm_token = $1 where ${on("harry@example.org", null)}`, ["h".repeat(32)]);

      report = await backfill();
      assert.ok(report.ok, JSON.stringify(report.checks.filter((c) => !c.ok)));
      const m = await subs();
      const first = m.get("email|follower@example.org|320193")!;
      assert.equal(first.status, "unsubscribed");
      assert.equal(first.unsubscribed_at, "2026-11-10T08:09:10.111213Z", "with the time the old site recorded");
      assert.equal(first.cadence, "digest", "the change made here is otherwise kept");
      assert.equal(m.get("email|follower@example.org|9000003")!.status, "active");
      assert.equal(m.get("email|upper@example.org|")!.status, "unsubscribed");
      assert.equal(m.get("email|combo@example.org|")!.status, "active");
      assert.equal(m.get("sms|+15555550104|")!.status, "unsubscribed");
      assert.equal(m.get("email|harry@example.org|")!.status, "pending");
      assert.ok(step("subscriptions").notes.join(" ").includes("Switched off 2 subscriptions that were changed on the new site"));
      // Nothing flips back on the next run.
      report = await backfill();
      assert.ok(report.ok);
      const again = await subs();
      for (const [k, v] of m) assert.equal(again.get(k)!.status, v.status, k);
    });

    /* ---------------------------------------------------------- switch-over */
    await test("the switch-over run copies pick alerts as send history, word for word", async () => {
      report = await backfill({ cutover: true });
      assert.ok(report.ok, JSON.stringify(report.checks.filter((c) => !c.ok)));
      type P = { ticker: string; kind: string; title: string; why: string; price: string | null; disclosure_text: string | null; cik: string | null;
        owns_shares: boolean | null; posted: string; company_name: string; legacy: Record<string, unknown> };
      const p = await rowsOf<P>(
        app,
        `select ticker, kind, title, why, price_at_post::text as price, disclosure_text, cik::text as cik, owns_shares, company_name, legacy,
                to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as posted
           from public.picks where imported_from = 'data-site:alerts' order by legacy_id::int`,
      );
      assert.equal(p.length, 4);
      assert.deepEqual(
        [p[0].ticker, p[0].kind, p[0].title, p[0].why, p[0].price, p[0].posted, p[0].company_name, p[0].owns_shares],
        ["AAPL", "pick", "BigStocks Alert: $AAPL", "Breaking out", "12.3400", "2026-10-01T12:15:00.250000Z", "Apple Inc.", null],
      );
      assert.equal(p[1].disclosure_text, "BigStocks was paid $2,500 in cash by Copperline Minerals for this alert.");
      assert.equal(p[1].kind, "sponsored");
      assert.equal(p[2].kind, "sponsored");
      assert.match(p[2].disclosure_text!, /did not record the compensation/);
      assert.equal(p[3].title, "BigStocks Premium Pick: $NOPE");
      assert.equal(p[3].cik, null);
      assert.equal(p[0].legacy.result, "win", "what the old site recorded is all kept");
      assert.equal(p[0].legacy.close_after, 12.9);
      assert.ok(step("picks").notes.join(" ").includes("1 sponsored alerts had no compensation text"));
      assert.equal(await num(app, `select count(*) from public.picks`), 6, "the old app's two picks are still there");
    });

    await test("the switch-over run copies sends and inquiries; an unfinished send can never be resumed here", async () => {
      const b = await rowsOf<{ status: string; error: string | null; linked: boolean; emails_sent: number }>(
        app, `select status, error, pick_id is not null as linked, emails_sent from public.broadcasts order by legacy_id::int`);
      assert.deepEqual(b.map((x) => [x.status, x.linked, x.emails_sent]), [["done", true, 3], ["failed", true, 4]]);
      assert.match(b[1].error!, /Not finished on the old site/);
      assert.equal(await num(app, `select count(*) from public.broadcasts where status in ('queued', 'sending')`), 0);
      const q = await rowsOf<{ name: string; phone: string | null; handled: boolean; notified: boolean }>(
        app, `select name, phone, handled_at is not null as handled, notified_at is not null as notified from public.inquiries order by legacy_id::int`);
      assert.deepEqual(q, [
        { name: "Ivy", phone: "+15555550999", handled: false, notified: true }, { name: "Jon", phone: null, handled: true, notified: false },
      ]);
      const before = await snapshot(app);
      report = await backfill({ cutover: true });
      assert.equal(step("picks").inserted + step("broadcasts").inserted + step("inquiries").inserted, 0);
      assert.equal(await snapshot(app), before, "running the switch-over copy again changes nothing");
    });

    await test("once the switch-over run is recorded, the copy refuses to run again unless told to", async () => {
      await app.query("begin");
      await recordBackfillRun(app, report, { cutover: false });
      await app.query("commit");
      report = await backfill({ cutover: true }); // an ordinary recorded run does not block anything
      await app.query("begin");
      await recordBackfillRun(app, report, { cutover: true });
      await app.query("commit");
      const before = await snapshot(app);
      await assert.rejects(backfill(), /switch-over copy already ran on \d{4}-\d\d-\d\d/);
      await assert.rejects(backfill({ cutover: true }), /--after-cutover/);
      assert.equal(await snapshot(app), before);
      const forced = await backfill({ cutover: true, afterCutover: true });
      assert.ok(forced.ok);
      assert.equal(await snapshot(app), before);
      const saved = await one<{ n: string; steps: string }>(
        app, `select count(*) as n, max(jsonb_array_length(report->'steps'))::text as steps from public.backfill_runs`);
      assert.deepEqual([saved.n, saved.steps], ["2", "9"], "the full report is kept with each recorded run");
    });

    /* ------------------------------------------------------------- security */
    const as = async <T>(role: "anon" | "authenticated", user: string | null, fn: () => Promise<T>): Promise<T> => {
      await app.query("begin");
      try {
        await app.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ""]);
        await app.query(`set local role ${role}`);
        return await fn();
      } finally {
        await app.query("rollback");
      }
    };

    await test("row-level security: a visitor sees none of the server-only tables", async () => {
      for (const t of ["companies", "company_tickers", "filings", "news", "news_sources", "summaries", "fundamentals_snapshots",
        "alert_events", "broadcasts", "inquiries", "picks", "users", "watchlists", "backfill_runs", "job_state", "summary_jobs",
        "login_tokens", "sessions", "suppressions", "digests", "rate_limits"]) {
        assert.equal(await as("anon", null, () => num(app, `select count(*) from public.${t}`)), 0, t);
      }
      await as("anon", null, () => assert.rejects(app.query(`select count(*) from public.alert_subscriptions`), /permission denied/));
      const rls = await rowsOf<{ relname: string }>(
        app,
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      );
      assert.deepEqual(rls, [], "every table in public has row-level security switched on");
    });

    await test("row-level security: a signed-in person sees only their own rows, and never tokens or consent records", async () => {
      await app.query(`update public.alert_subscriptions set user_id = $1 where address = 'alice@example.org' and cik = 320193`, [U1]);
      await as("authenticated", U1, async () => {
        assert.deepEqual(await rowsOf(app, `select email from public.users`), [{ email: "alice@example.org" }]);
        assert.equal(await num(app, `select count(*) from public.watchlists`), 1);
        assert.deepEqual(await rowsOf(app, `select address, status from public.alert_subscriptions`), [{ address: "alice@example.org", status: "active" }]);
      });
      for (const col of ["unsubscribe_token", "confirm_token", "legacy_token", "consent_ip", "consent_text", "legacy"]) {
        await as("authenticated", U1, () => assert.rejects(app.query(`select ${col} from public.alert_subscriptions`), /permission denied/, col));
      }
      await as("authenticated", U2, async () => {
        assert.equal(await num(app, `select count(*) from public.alert_subscriptions`), 0);
        assert.deepEqual(await rowsOf(app, `select email from public.users`), [{ email: "bob@example.org" }]);
      });
      for (const sql of [
        `update public.users set is_admin = true`, `insert into public.watchlists (user_id, cik) values ('${U1}', 789019)`,
        `update public.alert_subscriptions set status = 'active'`, `delete from public.watchlists`,
      ]) {
        const changed = await as("authenticated", U1, async () => {
          try {
            return (await app.query(sql)).rowCount ?? 0;
          } catch {
            return 0;
          }
        });
        assert.equal(changed, 0, `a signed-in browser must not be able to run: ${sql}`);
      }
    });
  } finally {
    await app.end().catch(() => {});
    await site.end().catch(() => {});
    for (const name of [appDb, siteDb]) await root.query(`drop database if exists ${name}`).catch((e) => console.log(`could not drop ${name}: ${e.message}`));
    await root.end();
  }
  if (!finish("database tests")) process.exit(1);
}

main().catch((e) => {
  console.error("database tests could not run:", (e as Error).message);
  process.exit(1);
});
