/**
 * Give (or take away) staff access: the /admin page, where picks are posted.
 *
 *   npm run admin:grant -- you@yourcompany.com            # give access
 *   npm run admin:grant -- you@yourcompany.com --remove   # take it away
 *   npm run admin:grant -- --list                         # who has it
 *
 * The person signs in with that email address as usual (an emailed link). The account is created
 * here if it does not exist yet.
 */
import "./load-env";
import { Client } from "pg";
import { normalizeEmail } from "../lib/auth/accounts";
import { connectionConfig } from "../lib/db/connect";
import { describeTarget, parseArgs } from "../lib/db/target";

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2), { flags: ["remove", "list"] });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (in .env or the environment)");
  const db = new Client(connectionConfig(url));
  await db.connect();
  try {
    console.log(`Database: ${describeTarget(url).label}`);
    if (flags.has("list")) {
      const { rows } = await db.query(`select email from public.users where is_admin order by email`);
      console.log(rows.length ? rows.map((r) => r.email).join("\n") : "Nobody has staff access.");
      return;
    }
    const email = normalizeEmail(rest[0]);
    if (!email) throw new Error("Give an email address: npm run admin:grant -- you@yourcompany.com");
    const on = !flags.has("remove");
    await db.query(`insert into public.users (email) select $1 where not exists (select 1 from public.users where lower(email) = $1)`, [email]);
    const r = await db.query(`update public.users set is_admin = $2 where lower(email) = $1`, [email, on]);
    if (!on) await db.query(`delete from public.sessions where user_id in (select id from public.users where lower(email) = $1)`, [email]);
    console.log(r.rowCount ? `${email}: staff access ${on ? "given" : "removed"}.` : `No account for ${email}.`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error("admin:grant failed:", (e as Error).message);
  process.exit(1);
});
