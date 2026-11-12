/**
 * Copy the two old databases into the unified tables (plan Phase 1, step 3).
 *
 *   DATABASE_URL            the one database (Supabase). The old app's tables are already in it.
 *   DATASITE_DATABASE_URL   the data site's own Postgres. Leave unset to copy only the old app's tables.
 *
 *   npm run backfill -- --dry-run            # do everything, print the counts, then undo it all
 *   npm run backfill -- --yes                # copy for real (everything except picks and broadcasts)
 *   npm run backfill -- --cutover --yes      # the switch-over run: also copy picks and broadcasts
 *   npm run backfill -- --only subscriptions --yes
 *   npm run backfill -- --skip news --yes
 *   npm run backfill -- --report out.json    # where to write the full report (default: backfill-report-<time>.json)
 *   npm run backfill -- --after-cutover ...  # only if the switch-over run has to be repeated before the new site opens
 *
 * The old tables are only read. Safe to run again until the switch-over: see lib/backfill/run.ts for
 * the rules. Every saved run is recorded in the backfill_runs table.
 * Run the migrations and load the company list first (docs/RUNBOOK.md).
 */
import "./load-env";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { CUTOVER_ONLY, recordBackfillRun, runBackfill, STEPS, type StepName } from "../lib/backfill/run";
import { describeTarget, parseArgs } from "../lib/db/target";

const LOCK_ID = 74_219_101;

function steps(list: string | undefined): StepName[] | undefined {
  if (!list) return undefined;
  const names = list.split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (!(STEPS as readonly string[]).includes(n)) throw new Error(`Unknown step "${n}". Steps: ${STEPS.join(", ")}`);
  return names as StepName[];
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (the one database)");
  const siteUrl = process.env.DATASITE_DATABASE_URL || null;
  const dryRun = flags.has("dry-run");
  const target = describeTarget(url);
  console.log(`Copying into: ${target.label}${dryRun ? " (dry run: everything is undone at the end)" : ""}`);
  console.log(siteUrl ? `Data site:    ${describeTarget(siteUrl).label} (read only)` : "Data site:    not given (only the old app's tables are copied)");
  if (siteUrl && siteUrl === url) throw new Error("DATASITE_DATABASE_URL and DATABASE_URL point at the same database");
  if (!dryRun && !target.isLocal && !flags.has("yes")) {
    throw new Error("This is not a local database. Try --dry-run first, take a backup (docs/RUNBOOK.md), then run again with --yes.");
  }

  const db = new Client({ connectionString: url });
  const site = siteUrl ? new Client({ connectionString: siteUrl }) : null;
  await db.connect();
  await site?.connect();
  let failed = false;
  try {
    // The old data site is read as one consistent snapshot and can never be written to from here.
    await site?.query("begin transaction isolation level repeatable read read only");
    await site?.query("set local timezone = 'UTC'");
    await db.query("begin");
    if (!(await db.query(`select pg_try_advisory_xact_lock($1) as ok`, [LOCK_ID])).rows[0].ok) {
      throw new Error("Another copy is already running against this database");
    }
    const report = await runBackfill(db, site, {
      only: steps(values.get("only")),
      skip: steps(values.get("skip")),
      cutover: flags.has("cutover"),
      afterCutover: flags.has("after-cutover"),
      log: (l) => console.log("  " + l),
    });
    failed = !report.ok;

    console.log("");
    console.log("step            old rows   copied  refreshed  left alone  skipped   before -> after");
    for (const s of report.steps) {
      const skipped = Object.values(s.skipped).reduce((a, b) => a + b, 0);
      const cells = [s.source, s.inserted, s.refreshed, s.leftAlone, skipped].map((n) => String(n).padStart(9));
      console.log(`${s.step.padEnd(14)}${s.ran ? cells.join(" ") + `   ${s.targetBefore} -> ${s.targetAfter}` : "   (not run)"}`);
      for (const [why, n] of Object.entries(s.skipped)) if (n) console.log(`      skipped ${n}: ${why}`);
      for (const note of s.notes) console.log(`      ${note}`);
    }
    console.log("");
    for (const c of report.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
    if (!flags.has("cutover")) console.log(`\nNot copied yet (they wait for the switch-over): ${CUTOVER_ONLY.join(", ")}`);

    const file = values.get("report") ?? `backfill-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), dryRun, cutover: flags.has("cutover"), ...report }, null, 2));
    console.log(`Full report: ${file}`);

    if (failed) {
      await db.query("rollback");
      console.error("\nA check failed, so nothing was saved.");
    } else if (dryRun) {
      await db.query("rollback");
      console.log("\nDry run: nothing was saved.");
    } else {
      await recordBackfillRun(db, report, { cutover: flags.has("cutover") });
      await db.query("commit");
      console.log("\nSaved.");
    }
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await site?.query("rollback").catch(() => {});
    await db.end();
    await site?.end();
  }
  if (failed) process.exit(2);
}

main().catch((e) => {
  console.error("backfill failed:", (e as Error).message);
  process.exit(1);
});
