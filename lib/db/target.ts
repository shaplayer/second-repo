/** Helpers for the command-line scripts that touch a database. */

export type DbTarget = { host: string; database: string; isLocal: boolean; label: string };

/** Where a connection string points, without the password. */
export function describeTarget(url: string): DbTarget {
  let host = "";
  let database = "";
  try {
    const u = new URL(url);
    host = u.searchParams.get("host") || decodeURIComponent(u.hostname);
    database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("The database connection string is not a valid URL");
  }
  const isLocal =
    host === "" || host.startsWith("/") || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  return {
    host: host || "(local socket)",
    database,
    isLocal,
    label: `${database || "(default database)"} on ${host || "local socket"}`,
  };
}

/** `--name value`, `--name=value` and `--flag` arguments. */
export function parseArgs(argv: string[]): { flags: Set<string>; values: Map<string, string> } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) {
      values.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(a.slice(2), next);
      i++;
    } else {
      flags.add(a.slice(2));
    }
  }
  return { flags, values };
}
