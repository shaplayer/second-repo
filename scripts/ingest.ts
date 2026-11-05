/**
 * Feed ingest worker. Pulls SEC EDGAR + newswire RSS into Postgres.
 *   npm run ingest:once   # one pass, prints a per-source report
 *   npm run ingest        # loop forever (run under PM2)
 */
import { fetchLatestFilings } from "../lib/feeds/edgar";
import { fetchPressReleases } from "../lib/feeds/rss";
import { saveItems } from "../lib/feeds/index";

const INTERVAL_MS = Number(process.env.INGEST_INTERVAL_SEC ?? 180) * 1000;

async function pass() {
  const started = Date.now();
  const [filings, press] = await Promise.all([fetchLatestFilings(), fetchPressReleases()]);
  const bySource = new Map<string, number>();
  for (const i of [...filings, ...press]) bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);
  const added = await saveItems([...filings, ...press]);
  console.log(
    `[ingest] ${new Date().toISOString()} fetched=${filings.length + press.length} new=${added} ` +
      [...bySource].map(([s, n]) => `${s}:${n}`).join(" ") + ` (${Date.now() - started}ms)`,
  );
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL (see .env.example)");
  if (process.argv.includes("--once")) { await pass(); process.exit(0); }
  for (;;) {
    await pass().catch((e) => console.error("[ingest] failed:", e?.message ?? e));
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
