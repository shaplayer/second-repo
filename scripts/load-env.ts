/**
 * Loads .env into process.env for scripts, if the file exists. Variables already set
 * (PM2 env, systemd, shell exports) win. Import this FIRST in every script.
 * Works on any Node version, unlike `node --env-file`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), ".env");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
