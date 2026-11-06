/** Create or upgrade the database tables. Safe to run again. */
import "./load-env";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL (in .env or the environment)");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(readFileSync("db/schema.sql", "utf8"));
  await pool.end();
  console.log("schema ok");
}
main().catch((e) => { console.error("db:init failed:", e.message); process.exit(1); });
