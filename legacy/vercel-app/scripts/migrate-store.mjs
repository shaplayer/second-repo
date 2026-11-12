// One-time move of data/store.json (the old local file) into Supabase. Safe to run again.
// Run with: node scripts/migrate-store.mjs
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, renameSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const file = new URL("../data/store.json", import.meta.url);
if (!existsSync(file)) {
  console.log("No data/store.json found. Nothing to move.");
  process.exit(0);
}
const data = JSON.parse(readFileSync(file, "utf8"));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ok = (label, { error, count }) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  console.log(`${label}: done${count != null ? ` (${count})` : ""}`);
};

const subs = (data.subscribers ?? []).map((s) => ({
  email: s.email,
  token: s.token,
  confirmed: s.confirmed,
  tickers: s.tickers,
  prefs: s.prefs,
  created_at: s.createdAt,
}));
ok(`Alert sign-ups (${subs.length})`, await db.from("alert_subscribers").upsert(subs, { onConflict: "email" }));

const sums = Object.values(data.summaries ?? {}).map((s) => ({
  accession: s.accession,
  ticker: s.ticker,
  company_name: s.companyName,
  form: s.form,
  accepted: s.accepted,
  url: s.url,
  headline: s.headline,
  bullets: s.bullets,
  why_it_matters: s.whyItMatters,
  tone: s.tone,
  importance: s.importance,
  category: s.category,
  created_at: s.createdAt,
}));
ok(`Filing summaries (${sums.length})`, await db.from("filing_summaries").upsert(sums, { onConflict: "accession" }));

const picks = (data.picks ?? []).map((p) => ({
  id: p.id,
  ticker: p.ticker,
  company_name: p.companyName,
  kind: p.kind,
  title: p.title,
  why: p.why,
  author: p.author,
  tier: p.tier,
  posted_at: p.postedAt,
  price_at_post: p.priceAtPost,
  owns_shares: p.ownsShares,
  ownership_note: p.ownershipNote ?? "",
  sponsor: p.sponsor ?? null,
  closed_at: p.closedAt ?? null,
  price_at_close: p.priceAtClose ?? null,
}));
ok(`Picks (${picks.length})`, await db.from("picks").upsert(picks, { onConflict: "id" }));

const seen = [...new Set(data.seen ?? [])].map((accession) => ({ accession }));
for (let i = 0; i < seen.length; i += 500) {
  ok(`Handled filings ${i + 1}-${Math.min(i + 500, seen.length)}`, await db.from("seen_filings").upsert(seen.slice(i, i + 500), { onConflict: "accession", ignoreDuplicates: true }));
}

if (data.lastPoll) ok("Last check time", await db.from("app_state").upsert({ key: "lastPoll", value: data.lastPoll }));

// Daily-summary queue: subscriber ids changed, so match them up by email.
const { data: rows } = await db.from("alert_subscribers").select("id, email");
const idByEmail = new Map(rows.map((r) => [r.email, r.id]));
const queue = [];
for (const [oldId, accs] of Object.entries(data.digest ?? {})) {
  const email = (data.subscribers ?? []).find((s) => s.id === oldId)?.email;
  const id = email && idByEmail.get(email);
  if (id) for (const accession of accs) if (data.summaries?.[accession]) queue.push({ subscriber_id: id, accession });
}
if (queue.length) ok(`Daily summary queue (${queue.length})`, await db.from("digest_queue").upsert(queue, { ignoreDuplicates: true }));

renameSync(file, new URL("../data/store.migrated.json", import.meta.url));
console.log("All moved. The old file was renamed to data/store.migrated.json as a backup.");
