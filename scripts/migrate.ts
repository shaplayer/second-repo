/**
 * Apply database migrations (supabase/migrations/*.sql) to the database in DATABASE_URL.
 *
 *   npm run db:migrate -- --dry-run                    # list what would run, change nothing
 *   npm run db:migrate -- --yes                        # apply
 *   npm run db:migrate -- --baseline 20261014004200 --yes
 *       # first run on a database where the older files were applied by hand: mark those as done
 *
 * On anything that is not a local database it refuses to run without --yes.
 */
import "./load-env";
import { Client } from "pg";
import { migrate } from "../lib/db/migrate";
import { describeTarget, parseArgs } from "../lib/db/target";

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (in .env or the environment)");
  const target = describeTarget(url);
  const dryRun = flags.has("dry-run");
  console.log(`Database: ${target.label}${dryRun ? " (dry run: nothing will change)" : ""}`);
  if (!dryRun && !target.isLocal && !flags.has("yes")) {
    throw new Error("This is not a local database. Take a backup first (docs/RUNBOOK.md), then run again with --yes.");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const r = await migrate(client, { baseline: values.get("baseline"), dryRun, log: (l) => console.log("  " + l) });
    console.log(
      dryRun
        ? `${r.pending.length} to apply, ${r.baselined.length} to mark as already applied, ${r.alreadyApplied} already applied.`
        : `Applied ${r.applied.length}, marked ${r.baselined.length} as already applied, ${r.alreadyApplied} were already applied.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  const message = (e as Error).message;
  console.error("db:migrate failed:", message);
  if (/^202610\d+_\w+\.sql failed/.test(message) && /already exists/.test(message)) {
    console.error(
      "This database already has the old app's tables, but its migration history does not list them.\n" +
        "Nothing was changed. Run again with:  npm run db:migrate -- --baseline 20261014004200 --yes",
    );
  }
  process.exit(1);
});
