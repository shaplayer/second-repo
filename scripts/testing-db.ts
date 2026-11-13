/**
 * A throwaway database for tests: created on a LOCAL Postgres, given the local stand-in for Supabase
 * and every migration, handed to the test, then dropped. Refuses any host that is not local.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { Client } from "pg";
import { loadCompanies } from "../lib/db/companies";
import { migrate } from "../lib/db/migrate";
import { describeTarget } from "../lib/db/target";
import { parseTickerFile } from "../lib/sec/companies";

export const ADMIN_URL =
  process.env.TEST_PG_URL ??
  `postgresql://${encodeURIComponent(process.env.PGUSER ?? os.userInfo().username)}@localhost/postgres?host=/var/run/postgresql`;

export const urlFor = (name: string) => {
  const u = new URL(ADMIN_URL);
  u.pathname = "/" + name;
  return u.toString();
};

/**
 * Runs `fn` against a fresh, fully migrated database holding the sample company list
 * (scripts/fixtures/company_tickers_exchange.sample.json). Returns false when there is no local
 * Postgres and `ifAvailable` is set (the caller prints that it skipped).
 */
export async function withTestDatabase(
  label: string, fn: (db: Client, url: string) => Promise<void>, opts: { ifAvailable?: boolean; companies?: boolean } = {},
): Promise<boolean> {
  const admin = describeTarget(ADMIN_URL);
  if (!admin.isLocal) throw new Error(`Database tests only run against a local Postgres. TEST_PG_URL points at ${admin.host}.`);
  const root = new Client({ connectionString: ADMIN_URL });
  try {
    await root.connect();
  } catch (e) {
    if (opts.ifAvailable) {
      console.log(`${label} tests SKIPPED: no local Postgres at ${admin.label} (${(e as Error).message}).`);
      return false;
    }
    throw new Error(`No local Postgres at ${admin.label}: ${(e as Error).message}`);
  }
  const name = `bs_test_${label.replace(/[^a-z0-9]/g, "_")}_${process.pid}`;
  await root.query(`create database ${name}`);
  const db = new Client({ connectionString: urlFor(name) });
  try {
    await db.connect();
    await db.query("set client_min_messages = warning");
    await db.query(readFileSync("db/local/supabase-shim.sql", "utf8"));
    await migrate(db);
    if (opts.companies !== false) {
      const parsed = parseTickerFile(JSON.parse(readFileSync("scripts/fixtures/company_tickers_exchange.sample.json", "utf8")));
      await db.query("begin");
      await loadCompanies(db, parsed.tickers);
      await db.query("commit");
    }
    await fn(db, urlFor(name));
  } finally {
    await db.end().catch(() => {});
    await root.query(`drop database if exists ${name}`).catch((e) => console.log(`could not drop ${name}: ${e.message}`));
    await root.end();
  }
  return true;
}
