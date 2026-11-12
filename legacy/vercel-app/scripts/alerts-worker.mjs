// Checks the SEC for new filings every minute and sends the 6 PM ET daily summaries.
// Run it next to the website with: npm run alerts
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = (process.env.APP_URL || env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET || env.CRON_SECRET;
if (!SECRET) throw new Error("CRON_SECRET is missing from .env");

const call = async (path) => {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${SECRET}` } });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
};

const etNow = () => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
};

let lastDigestDay = "";
console.log(`Alert checker running against ${BASE}. Press Ctrl+C to stop.`);

async function tick() {
  const time = new Date().toLocaleTimeString("en-US");
  try {
    const r = await call("/api/cron/filings");
    const b = r.body;
    if (!r.ok) console.log(`${time}  error: ${b.error ?? "unknown"}`);
    else if (b.matched || b.errors?.length) console.log(`${time}  ${b.matched} new filing(s), ${b.emailed} email(s) sent, ${b.queued} queued for the daily summary`, b.errors?.length ? b.errors : "");
    else console.log(`${time}  checked ${b.checked} recent SEC filings, nothing new for your followers`);

    const { day, hour } = etNow();
    if (hour >= 18 && lastDigestDay !== day) {
      lastDigestDay = day;
      const d = await call("/api/cron/digest");
      console.log(`${time}  daily summaries sent: ${d.body.sent ?? 0}`, d.body.errors?.length ? d.body.errors : "");
    }
  } catch (e) {
    console.log(`${time}  couldn't reach the website (${e.message}). Is "npm run dev" running?`);
  }
}

await tick();
setInterval(tick, 60_000);
