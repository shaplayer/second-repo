/**
 * Load the SEC's company and ticker list into the database in DATABASE_URL.
 *
 *   npm run companies:load -- --dry-run            # download, show the counts, change nothing
 *   npm run companies:load -- --yes                # download and save
 *   npm run companies:load -- --file list.json     # use a file you already downloaded
 *   npm run companies:load -- --prune --yes        # also drop tickers that left the SEC list
 *   npm run companies:load -- --exchanges Nasdaq,NYSE --yes   # only these exchanges (default: every ticker)
 *
 * Downloading needs SEC_USER_AGENT (your company name and a monitored email). Safe to run again.
 */
import "./load-env";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { loadCompanies } from "../lib/db/companies";
import { connectionConfig } from "../lib/db/connect";
import { describeTarget, parseArgs } from "../lib/db/target";
import { parseTickerFile, SEC_TICKERS_EXCHANGE_URL } from "../lib/sec/companies";
import { secUserAgent } from "../lib/sec/user-agent";

async function download(): Promise<unknown> {
  const res = await fetch(SEC_TICKERS_EXCHANGE_URL, {
    headers: { "User-Agent": secUserAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`The SEC answered ${res.status} ${res.statusText} for the ticker list`);
  return res.json();
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2), { flags: ["dry-run", "yes", "prune"], values: ["file", "exchanges"] });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (in .env or the environment)");
  const target = describeTarget(url);
  const dryRun = flags.has("dry-run");
  console.log(`Database: ${target.label}${dryRun ? " (dry run: nothing will change)" : ""}`);
  if (!dryRun && !flags.has("yes")) {
    throw new Error("This would change the database. Run again with --yes to save (or --dry-run to look first).");
  }

  const file = values.get("file");
  const json = file ? JSON.parse(readFileSync(file, "utf8")) : await download();
  const parsed = parseTickerFile(json);
  const only = values.get("exchanges")?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const rows = only ? parsed.tickers.filter((t) => only.includes((t.exchange ?? "").toLowerCase())) : parsed.tickers;
  if (only) {
    // The main ticker of a company must be one we keep.
    const seen = new Set<number>();
    for (const r of rows) {
      r.isPrimary = !seen.has(r.cik);
      seen.add(r.cik);
    }
  }
  console.log(`SEC list: ${parsed.tickers.length} tickers, ${parsed.companies} companies, ${parsed.skipped.length} lines skipped.`);
  if (only) console.log(`Keeping ${rows.length} tickers on: ${only.join(", ")}`);

  const client = new Client(connectionConfig(url));
  await client.connect();
  try {
    await client.query("begin");
    const r = await loadCompanies(client, rows, { prune: flags.has("prune") });
    await client.query(dryRun ? "rollback" : "commit");
    console.log(JSON.stringify(r, null, 2));
    console.log(dryRun ? "Dry run: nothing was saved." : "Saved.");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("companies:load failed:", (e as Error).message);
  process.exit(1);
});
