/**
 * Diagnose the news feed from THIS server:  npm run feeds:check
 * Checks every source the site reads, then the database, and says what's wrong.
 */
import "./load-env";
import { fetchText } from "../lib/feeds/http";
import { parseEdgarAtom } from "../lib/feeds/edgar";
import { parseRss } from "../lib/feeds/rss";
import { EDGAR_TICKERS_URL, PRESS_FEEDS, SEC_USER_AGENT, edgarCurrentUrl } from "../lib/feeds/sources";

const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => console.log(`  ✗ ${s}`);
const why = (e: unknown) => {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  return err.cause?.code ? `${err.message} (${err.cause.code}${err.cause.message ? `: ${err.cause.message}` : ""})` : err.message;
};

async function main() {
  let problems = 0;
  console.log(`Node ${process.version} · SEC_USER_AGENT="${SEC_USER_AGENT}"`);
  if (!process.env.SEC_USER_AGENT) { problems++; bad("SEC_USER_AGENT not set: SEC asks for your company name + a real contact email"); }

  console.log("\nSEC EDGAR");
  let lookup: ((cik: number) => { ticker: string; name: string } | undefined) | null = null;
  try {
    const t = Date.now();
    const map = JSON.parse(await fetchText(EDGAR_TICKERS_URL, 30000)) as Record<string, { cik_str: number; ticker: string; title: string }>;
    const byCik = new Map(Object.values(map).map((r) => [r.cik_str, { ticker: r.ticker, name: r.title }]));
    lookup = (cik) => byCik.get(cik);
    ok(`ticker map: ${byCik.size} companies (${Date.now() - t}ms)`);
  } catch (e) { problems++; bad(`ticker map: ${why(e)}`); }
  try {
    const t = Date.now();
    const atom = await fetchText(edgarCurrentUrl("8-K"), 20000);
    const n = lookup ? parseEdgarAtom(atom, lookup).length : 0;
    (n ? ok : bad)(`latest 8-K filings: ${n} with tickers (${Date.now() - t}ms)`);
    if (!n) problems++;
  } catch (e) { problems++; bad(`latest filings: ${why(e)}`); }

  console.log("\nNewswires");
  let pressTotal = 0;
  for (const f of PRESS_FEEDS) {
    const label = `${f.source}${f.enabled ? "" : " (disabled)"}`;
    try {
      const body = await fetchText(f.url, 15000);
      const items = parseRss(body, f.source).length;
      const raw = (body.match(/<item[\s>]/g) ?? []).length;
      if (f.enabled) pressTotal += items;
      (items ? ok : bad)(`${label}: ${raw} items, ${items} with a ticker`);
      if (!f.enabled && items) console.log(`      works from this server: you can set enabled: true in lib/feeds/sources.ts`);
    } catch (e) {
      if (f.enabled) problems++;
      bad(`${label}: ${why(e)}`);
    }
  }

  console.log("\nDatabase");
  if (!process.env.DATABASE_URL) {
    console.log("  - DATABASE_URL not set: the site fetches feeds live and caches them in memory (OK for testing)");
  } else {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const r = await pool.query(`SELECT kind, count(*)::int AS n, max(ingested_at) AS last FROM news_items GROUP BY kind`);
      await pool.end();
      if (!r.rows.length) { problems++; bad("news_items is empty: run `npm run ingest:once`, then keep `npm run ingest` running (PM2)"); }
      for (const row of r.rows) {
        const mins = Math.round((Date.now() - new Date(row.last).getTime()) / 60000);
        (mins < 30 ? ok : bad)(`${row.kind}: ${row.n} items, last ingest ${mins} min ago`);
        if (mins >= 30) { problems++; console.log("      ingest worker isn't running: `pm2 status`, then `pm2 logs bigstocks-ingest`"); }
      }
    } catch (e) {
      problems++;
      bad(`database: ${why(e)}`);
      if (/news_items/.test(String(e))) console.log("      tables missing: run `npm run db:init`");
    }
  }

  console.log(`\n${problems ? `${problems} problem(s) found above.` : "All good."} Press releases available now: ${pressTotal}`);
  if (problems) {
    console.log("Common causes: server firewall blocks outbound HTTPS (port 443); a corporate proxy (Node's fetch ignores");
    console.log("HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 on Node >= 22.21); SEC blocking a generic or missing SEC_USER_AGENT.");
  }
  process.exit(problems ? 1 : 0);
}
main();
