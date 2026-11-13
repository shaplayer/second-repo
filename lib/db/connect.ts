/**
 * How to open a database connection: the one place that decides about encryption.
 *
 * The `pg` driver sends everything in clear text unless told otherwise. Our database is on another
 * company's servers, and the connection carries email addresses, consent records and link codes, so:
 *
 *   - a database on this machine: no change (local tests and the throwaway databases);
 *   - any other database: the connection is always encrypted. With DATABASE_SSL_CA set to the path of
 *     the provider's certificate file, the server is also checked against it (recommended);
 *   - a connection string that says `sslmode=...` itself is left exactly as written.
 */
import { readFileSync } from "node:fs";
import type { ClientConfig } from "pg";
import { describeTarget } from "./target";

export function connectionConfig(url: string, env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const target = describeTarget(url, env);
  let ownChoice = false;
  try {
    const p = new URL(url).searchParams;
    ownChoice = p.has("sslmode") || p.has("ssl");
  } catch {
    // describeTarget has already refused a string that is not a URL.
  }
  if (target.isLocal || ownChoice) return { connectionString: url };
  const caFile = (env.DATABASE_SSL_CA ?? "").trim();
  if (!caFile) return { connectionString: url, ssl: { rejectUnauthorized: false } };
  let ca: string;
  try {
    ca = readFileSync(caFile, "utf8");
  } catch {
    throw new Error(`DATABASE_SSL_CA points at ${caFile}, which could not be read`);
  }
  return { connectionString: url, ssl: { ca, rejectUnauthorized: true } };
}
