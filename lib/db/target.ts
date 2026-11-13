/** Helpers for the command-line scripts that touch a database. */

export type DbTarget = { host: string; database: string; isLocal: boolean; label: string };

const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const isLocalHost = (h: string) => h.startsWith("/") || LOCAL_NAMES.has(h.toLowerCase());

/**
 * Where a connection string points, without the user name or password.
 *
 * "Local" is judged strictly: every place the connection could go has to be this machine. A string
 * that names a host twice (in the address and again as `?host=`), or names none and leaves it to the
 * PGHOST environment variable, counts as local only if all of those are local.
 */
export function describeTarget(url: string, env: NodeJS.ProcessEnv = process.env): DbTarget {
  let hosts: string[] = [];
  let database = "";
  try {
    const u = new URL(url);
    hosts = [decodeURIComponent(u.hostname), ...u.searchParams.getAll("host"), ...u.searchParams.getAll("hostaddr")].filter(Boolean);
    database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("The database connection string is not a valid URL");
  }
  // No host anywhere in the string: the driver falls back to PGHOST, then to the local socket.
  if (!hosts.length && env.PGHOST) hosts = [env.PGHOST];
  const isLocal = hosts.every(isLocalHost);
  // Show the host a person would least expect: a remote one if there is any.
  const shown = hosts.find((h) => !isLocalHost(h)) ?? hosts[hosts.length - 1] ?? "";
  return {
    host: shown || "(local socket)",
    database,
    isLocal,
    label: `${database || "(default database)"} on ${shown || "local socket"}`,
  };
}

/**
 * `--name value`, `--name=value` and `--flag` arguments. Anything not on the two lists is refused, and
 * so is a value given to a plain flag: a mistyped `--dryrun`, or `--dry-run=true`, must never turn a
 * rehearsal into a real run.
 */
export function parseArgs(
  argv: string[], allowed?: { flags?: string[]; values?: string[] },
): { flags: Set<string>; values: Map<string, string>; rest: string[] } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const rest: string[] = [];
  const isFlag = (n: string) => !allowed || (allowed.flags ?? []).includes(n);
  const isValue = (n: string) => !allowed || (allowed.values ?? []).includes(n);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq > 0 ? eq : undefined);
    if (allowed && !isFlag(name) && !isValue(name)) {
      throw new Error(`Unknown option --${name}. Options: ${[...(allowed.flags ?? []), ...(allowed.values ?? [])].map((n) => "--" + n).join(", ")}`);
    }
    if (eq > 0) {
      if (allowed && !isValue(name)) throw new Error(`--${name} takes no value (write just --${name})`);
      values.set(name, a.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (allowed ? isValue(name) : next !== undefined && !next.startsWith("--")) {
      if (next === undefined || next.startsWith("--")) throw new Error(`--${name} needs a value`);
      values.set(name, next);
      i++;
    } else {
      flags.add(name);
    }
  }
  return { flags, values, rest };
}
