/**
 * Applies the SQL files in supabase/migrations/ in order, once each.
 *
 * It keeps its record in supabase_migrations.schema_migrations, the same table the Supabase tools
 * use, so this runner and `supabase db push` agree on what has been applied. Each file runs in its own
 * transaction: it either applies completely or not at all.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";

export type Migration = { version: string; name: string; file: string; sql: string };
export type MigrateResult = { applied: string[]; baselined: string[]; alreadyApplied: number; pending: string[] };

const FILE_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const LOCK_ID = 74_219_100;

export function readMigrations(dir = path.join(process.cwd(), "supabase/migrations")): Migration[] {
  const out: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    const m = FILE_RE.exec(file);
    if (!m) {
      if (file.endsWith(".sql")) throw new Error(`Migration file name must look like 20261112200000_name.sql: ${file}`);
      continue;
    }
    out.push({ version: m[1], name: m[2], file, sql: readFileSync(path.join(dir, file), "utf8") });
  }
  const versions = new Set(out.map((m) => m.version));
  if (versions.size !== out.length) throw new Error("Two migration files share the same version number");
  return out;
}

/** The columns of the history table, creating it first if needed. A dry run creates nothing: no table means no columns. */
async function historyColumns(client: Client, dryRun: boolean): Promise<Set<string>> {
  if (!dryRun) {
    await client.query(`create schema if not exists supabase_migrations`);
    await client.query(
      `create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`,
    );
  }
  const { rows } = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`,
  );
  return new Set(rows.map((r) => r.column_name));
}

async function record(client: Client, cols: Set<string>, m: Migration) {
  const names = ["version"];
  const values: unknown[] = [m.version];
  if (cols.has("name")) {
    names.push("name");
    values.push(m.name);
  }
  if (cols.has("statements")) {
    names.push("statements");
    values.push([m.sql]);
  }
  const placeholders = names.map((_, i) => "$" + (i + 1)).join(", ");
  await client.query(
    `insert into supabase_migrations.schema_migrations (${names.join(", ")}) values (${placeholders})`,
    values,
  );
}

export type MigrateOptions = {
  dir?: string;
  /** Mark every migration up to and including this version as applied without running it. */
  baseline?: string;
  /** Stop after this version (used by tests to seed old data before the new files run). */
  upTo?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
};

export async function migrate(client: Client, opts: MigrateOptions = {}): Promise<MigrateResult> {
  const log = opts.log ?? (() => {});
  const all = readMigrations(opts.dir);
  const result: MigrateResult = { applied: [], baselined: [], alreadyApplied: 0, pending: [] };
  await client.query(`select pg_advisory_lock($1)`, [LOCK_ID]);
  try {
    const cols = await historyColumns(client, opts.dryRun === true);
    const done = new Set(
      cols.size
        ? (await client.query<{ version: string }>(`select version from supabase_migrations.schema_migrations`)).rows.map((r) => r.version)
        : [],
    );
    for (const m of all) {
      if (done.has(m.version)) {
        result.alreadyApplied++;
        continue;
      }
      if (opts.upTo && m.version > opts.upTo) {
        result.pending.push(m.file);
        continue;
      }
      if (opts.baseline && m.version <= opts.baseline) {
        if (!opts.dryRun) await record(client, cols, m);
        result.baselined.push(m.file);
        log(`marked as already applied: ${m.file}`);
        continue;
      }
      if (opts.dryRun) {
        result.pending.push(m.file);
        log(`would apply: ${m.file}`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(m.sql);
        await record(client, cols, m);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw new Error(`${m.file} failed and was rolled back: ${(e as Error).message}`);
      }
      result.applied.push(m.file);
      log(`applied: ${m.file}`);
    }
    return result;
  } finally {
    await client.query(`select pg_advisory_unlock($1)`, [LOCK_ID]).catch(() => {});
  }
}
