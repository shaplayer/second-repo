/**
 * The always-on worker (plan §3). One process, run by PM2 on the Droplet:  npm run worker
 *
 * What it does, and how often:
 *   every 10 s (6 AM-10 PM New York on weekdays; every 60 s otherwise)
 *       read the SEC's list of latest filings, store the new ones, make alerts for followers
 *   every 2 s    read press releases attached to new filings and insider-trade details;
 *                write waiting summaries; send waiting alert emails
 *   every 5 s    gather the SEC record and health check of companies someone just opened or followed
 *   every 10 min read the newswire feeds that are switched on
 *   6:00 PM New York   send the daily summaries
 *   2:30 AM New York   refresh every followed company's record and health check; reload the company list
 *   hourly       tidy up (expired sign-in links, old counters), retry failed team notifications
 *
 * Every SEC request goes through one client that sends SEC_USER_AGENT and stays under 8 requests a
 * second in total. The worker refuses to start without a real SEC_USER_AGENT.
 *
 * Switches (environment):
 *   ALERTS_SENDING=off   do everything except send email (the 48-hour side-by-side check, plan Phase 6)
 *   WORKER_ONCE=1        run each regular job once and exit (for a check after deploying). The two daily
 *                        jobs are left out, so the check never sends the daily summary early.
 */
import "./load-env";
import { Pool } from "pg";
import { clearExpiredAuth } from "../lib/auth/accounts";
import { matchNewItems } from "../lib/alerts/match";
import { sendDigests, sendQueuedAlerts } from "../lib/alerts/send";
import { growthRulesEnabled, teamInbox } from "../lib/config";
import { loadCompanies } from "../lib/db/companies";
import { connectionConfig } from "../lib/db/connect";
import { emailProvider } from "../lib/email";
import { classifyFilings } from "../lib/ingest/classify";
import { nextCompaniesToRefresh, refreshCompanyHealth, refreshCompanyProfile } from "../lib/ingest/company";
import { processFilingDetails } from "../lib/ingest/detail";
import { pollCurrentFilings } from "../lib/ingest/filings";
import { pollPressFeeds } from "../lib/ingest/press";
import { runJob, setJobDetail } from "../lib/ingest/state";
import { clearOldLimits } from "../lib/limits";
import { createSecClient, type SecClient } from "../lib/sec/client";
import { parseTickerFile, SEC_TICKERS_EXCHANGE_URL } from "../lib/sec/companies";
import type { Summarizer } from "../lib/summaries/claude";
import { processSummaryJobs } from "../lib/summaries/jobs";

const NY = "America/New_York";
const nyParts = (d = new Date()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekend: p.weekday === "Sat" || p.weekday === "Sun" };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type WorkerOptions = {
  db: Pool;
  sec: SecClient;
  /** Send alert emails. Off for the side-by-side check before going live. */
  sending: boolean;
  /** Write AI summaries (needs ANTHROPIC_API_KEY). */
  summaries: boolean;
  /** Run every regular job once and return (the deploy check and the tests). */
  once: boolean;
  /** With `once`: also run the two daily jobs (the tests do; the deploy check does not, so it never sends the daily summary early). */
  onceDaily?: boolean;
  /** Replaceable for tests: the fetch used for newswire feeds, and the writer of summaries. */
  pressFetch?: typeof fetch;
  summarizer?: Summarizer;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const sec = createSecClient(); // throws here, at start, when SEC_USER_AGENT is missing or a placeholder
  const db = new Pool({ ...connectionConfig(process.env.DATABASE_URL), max: 4 });
  const sending = (process.env.ALERTS_SENDING ?? "on").toLowerCase() !== "off";
  const summaries = Boolean(process.env.ANTHROPIC_API_KEY);
  console.log(`[worker] started. Sending email: ${sending ? "on" : "OFF"}. Summaries: ${summaries ? "on" : "OFF (no ANTHROPIC_API_KEY)"}. Email service: ${emailProvider().name}.`);
  await runWorker({ db, sec, sending, summaries, once: process.env.WORKER_ONCE === "1" });
  await db.end();
  console.log("[worker] stopped.");
}

export async function runWorker({ db, sec, sending, summaries, once, onceDaily, pressFetch, summarizer }: WorkerOptions): Promise<void> {

  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; console.log(`[worker] ${sig}: finishing the current job, then stopping.`); });

  /** Runs `fn` again and again, `gap()` milliseconds after each run ends, until the worker stops. */
  const every = async (job: string, gap: () => number, fn: () => Promise<unknown>) => {
    do {
      await runJob(db, job, fn);
      if (once) return;
      const wait = gap();
      for (let t = 0; t < wait && !stopping; t += 500) await sleep(Math.min(500, wait - t));
    } while (!stopping);
  };
  /** Runs `fn` once a day, the first time the New York clock passes hour:minute. Remembers the day in job_state. */
  const daily = async (job: string, hour: number, minute: number, fn: () => Promise<unknown>) => {
    if (once) {
      if (onceDaily) await runJob(db, job, fn);
      return;
    }
    while (!stopping) {
      const now = nyParts();
      const { rows } = await db.query<{ day: string | null }>(`select detail->>'day' as day from public.job_state where job = $1`, [job]).catch(() => ({ rows: [] }));
      if ((now.hour > hour || (now.hour === hour && now.minute >= minute)) && rows[0]?.day !== now.date) {
        await runJob(db, job, fn);
        await setJobDetail(db, job, { day: now.date }).catch(() => {});
      }
      for (let t = 0; t < 30_000 && !stopping; t += 500) await sleep(500);
    }
  };

  const filingHours = () => {
    const n = nyParts();
    return !n.weekend && n.hour >= 6 && n.hour < 22;
  };

  const loops = [
    () => every("filings", () => (filingHours() ? 10_000 : 60_000), async () => {
      const r = await pollCurrentFilings(db, sec);
      await classifyFilings(db, 2000);
      const m = await matchNewItems(db);
      await setJobDetail(db, "filings:last", { pages: r.fetchedPages, new: r.newFilings.length, alerts: m.events, at: new Date().toISOString() });
    }),
    () => every("details", () => 2_000, () => processFilingDetails(db, sec, { limit: 10 })),
    () => every("press", () => 600_000, async () => {
      await pollPressFeeds(db, pressFetch ? { fetch: pressFetch } : {});
      await matchNewItems(db);
    }),
    () => every("match", () => 2_000, () => matchNewItems(db)),
    () => every("summaries", () => 2_000, async () => {
      if (summaries) await processSummaryJobs(db, sec, { limit: 3, summarizer });
    }),
    () => every("send", () => 2_000, async () => {
      if (!sending) return;
      for (let i = 0; i < 20; i++) {
        const r = await sendQueuedAlerts(db, { limit: 500 });
        if (r.sent + r.failed + r.retrying + r.suppressed === 0) break;
      }
    }),
    () => every("companies", () => 5_000, async () => {
      // Never-checked companies first: someone just opened their page and is waiting.
      const today = nyParts().date;
      for (const cik of await nextCompaniesToRefresh(db, "profile", 3, 24 * 365)) await refreshCompanyProfile(db, sec, cik);
      for (const cik of await nextCompaniesToRefresh(db, "facts", 3, 24 * 365)) {
        await refreshCompanyHealth(db, sec, cik, { today, growthRules: growthRulesEnabled() });
      }
    }),
    () => every("housekeeping", () => 3_600_000, async () => {
      await clearExpiredAuth(db);
      await clearOldLimits(db);
      await retryInquiryNotices(db);
      // A company nobody follows and nobody has opened for a month leaves the nightly list.
      await db.query(
        `update public.companies c set tracked = false
          where c.tracked and coalesce(c.viewed_at, c.created_at) < now() - interval '30 days'
            and not exists (select 1 from public.watchlists w where w.cik = c.cik)
            and not exists (select 1 from public.alert_subscriptions s where s.cik = c.cik and s.status = 'active')`,
      );
    }),
    () => daily("digest", 18, 0, async () => {
      if (sending) await sendDigests(db);
    }),
    () => daily("nightly", 2, 30, async () => {
      const today = nyParts().date;
      // The SEC's company and ticker list: new listings, ticker changes.
      const list = parseTickerFile(await sec.json(SEC_TICKERS_EXCHANGE_URL));
      const c = await db.connect();
      try {
        await c.query("begin");
        await loadCompanies(c, list.tickers);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
      // Every followed or recently opened company: its SEC record, then its health check.
      for (;;) {
        const ciks = await nextCompaniesToRefresh(db, "profile", 50, 20);
        if (!ciks.length || stopping) break;
        for (const cik of ciks) await refreshCompanyProfile(db, sec, cik).catch((e) => console.error(`[nightly] profile ${cik}: ${(e as Error).message}`));
      }
      for (;;) {
        const ciks = await nextCompaniesToRefresh(db, "facts", 50, 20);
        if (!ciks.length || stopping) break;
        for (const cik of ciks) {
          await refreshCompanyHealth(db, sec, cik, { today, growthRules: growthRulesEnabled() }).catch((e) => console.error(`[nightly] health ${cik}: ${(e as Error).message}`));
        }
      }
    }),
  ];
  if (once) {
    // One job at a time, in the order a real day would run them, so the result is the same every time.
    for (const loop of loops) await loop();
    return;
  }
  await Promise.all(loops.map((loop) => loop()));
}

/** Sponsor inquiries whose notification email to the team failed are tried again. */
async function retryInquiryNotices(db: Pool): Promise<void> {
  const to = teamInbox();
  if (!to.length) return;
  const { rows } = await db.query(
    `select id::text as id, name, company, ticker, email, phone, package, message from public.inquiries
      where notified_at is null and imported_from is null and created_at > now() - interval '7 days' order by id limit 20`,
  );
  for (const q of rows) {
    await emailProvider().send({
      to, replyTo: q.email, subject: `Sponsor inquiry: ${q.company}${q.ticker ? ` (${q.ticker})` : ""}`,
      text: [`Name: ${q.name}`, `Company: ${q.company}`, `Ticker: ${q.ticker ?? "-"}`, `Email: ${q.email}`, `Phone: ${q.phone ?? "-"}`, `Interested in: ${q.package ?? "-"}`, "", q.message ?? ""].join("\n"),
    });
    await db.query(`update public.inquiries set notified_at = now() where id = $1`, [q.id]);
  }
}

// Started as a program (not imported by a test): run.
if (process.argv[1] && /(^|[\\/])worker\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("[worker] could not start:", (e as Error).message);
    process.exit(1);
  });
}
