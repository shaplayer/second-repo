import { alertEmail, digestEmail, sendEmail } from "./email";
import { categoryOf, explain } from "./plain";
import { companies, recentFilings } from "./sec";
import {
  claimFiling,
  clearDigest,
  confirmedSubscribers,
  getState,
  pendingDigests,
  queueDigest,
  saveSummary,
  setState,
  unseen,
  type Subscriber,
  type Summary,
} from "./store";
import { summarize, type FilingRef } from "./summarize";

const UA = process.env.SEC_USER_AGENT || "BigStocks.com admin@bigstocks.com";

type FeedEntry = { accession: string; cik: number; form: string; updated: string };

/** One page of the SEC's "latest filings" feed (every company, newest first). */
async function feedPage(start: number): Promise<FeedEntry[]> {
  const res = await fetch(
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&start=${start}&count=100&output=atom`,
    { headers: { "User-Agent": UA }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`SEC latest-filings feed failed (${res.status})`);
  const xml = await res.text();
  return xml
    .split("<entry>")
    .slice(1)
    .flatMap((e) => {
      const cik = e.match(/<title>[^<]*\((\d{10})\)/)?.[1];
      const accession = e.match(/accession-number=([\d-]+)/)?.[1];
      const updated = e.match(/<updated>([^<]+)<\/updated>/)?.[1];
      const form = e.match(/term="([^"]+)"/)?.[1];
      return cik && accession && updated && form ? [{ cik: +cik, accession, form, updated: new Date(updated).toISOString() }] : [];
    });
}

const wants = (s: Subscriber, ticker: string, category: Summary["category"]) =>
  s.confirmed && s.tickers.includes(ticker) && s.prefs[category];

/** Used when Claude can't summarize (no key, outage): the alert still goes out on time. */
function basicSummary(f: FilingRef, category: Summary["category"]): Summary {
  const p = explain(f);
  return {
    accession: f.accession,
    ticker: f.ticker,
    companyName: f.companyName,
    form: f.form,
    accepted: f.accepted,
    url: f.url,
    headline: p?.title ?? `New ${f.form} filing`,
    bullets: [p?.meaning ?? "The company filed a new document with the SEC."],
    whyItMatters: "Open the original filing for the details.",
    tone: "Routine",
    importance: p?.importance ?? "Medium",
    category,
    createdAt: new Date().toISOString(),
  };
}

export type PollResult = { checked: number; matched: number; emailed: number; queued: number; errors: string[] };

let running = false;

/** Look for new filings from stocks people follow, summarize them, and send alerts. Run every minute. */
export async function pollFilings(): Promise<PollResult> {
  if (running) return { checked: 0, matched: 0, emailed: 0, queued: 0, errors: ["Already running"] };
  running = true;
  const result: PollResult = { checked: 0, matched: 0, emailed: 0, queued: 0, errors: [] };
  try {
    const [subscribers, lastPoll] = await Promise.all([confirmedSubscribers(), getState("lastPoll")]);
    const followed = new Set(subscribers.flatMap((s) => s.tickers));
    const startedAt = new Date().toISOString();
    if (!followed.size) {
      await setState("lastPoll", startedAt);
      return result;
    }

    const cos = await companies();
    const byCik = new Map<number, { ticker: string; name: string }>();
    for (const t of followed) {
      const c = cos.get(t);
      if (c) byCik.set(c.cik, { ticker: t, name: c.name });
    }

    // Read back to 10 minutes before the last check (first run: last 15 minutes) so nothing slips between polls.
    const since = new Date(Date.parse(lastPoll ?? startedAt) - (lastPoll ? 10 : 15) * 60_000).toISOString();
    const entries: FeedEntry[] = [];
    for (let start = 0; start < 1000; start += 100) {
      const page = await feedPage(start);
      entries.push(...page);
      if (!page.length || page[page.length - 1].updated < since) break;
    }
    result.checked = entries.length;

    const fresh = entries.filter((e) => e.updated >= since && byCik.has(e.cik));
    const candidates = [...new Map(fresh.map((e) => [e.accession, e])).values()];
    const notSeen = new Set(await unseen(candidates.map((e) => e.accession)));
    const unique = candidates.filter((e) => notSeen.has(e.accession));

    for (const entry of unique) {
      const co = byCik.get(entry.cik)!;
      const filing = (await recentFilings(entry.cik)).find((f) => f.accession === entry.accession);
      if (!filing) continue; // not in the company's filing list yet; try again next minute
      // Claim it first, so two checkers running at once can never both email the same filing.
      if (!(await claimFiling(entry.accession))) continue;
      const f: FilingRef = { ...filing, cik: entry.cik, ticker: co.ticker, companyName: co.name };
      const category = categoryOf(f);
      const recipients = category ? subscribers.filter((s) => wants(s, co.ticker, category)) : [];
      if (category && recipients.length) {
        result.matched++;
        let summary: Summary;
        try {
          summary = await summarize(f);
        } catch (e) {
          result.errors.push(`${co.ticker} ${f.form}: ${(e as Error).message}`);
          summary = basicSummary(f, category);
        }
        for (const s of recipients) {
          if (s.prefs.mode === "daily") {
            await saveSummary(summary, true);
            await queueDigest(s.id, f.accession);
            result.queued++;
          } else {
            try {
              await sendEmail(alertEmail(s, summary));
              result.emailed++;
            } catch (e) {
              result.errors.push(`Email to subscriber ${s.id}: ${(e as Error).message}`);
            }
          }
        }
      }
    }
    await setState("lastPoll", startedAt);
    return result;
  } finally {
    running = false;
  }
}

/** Send each "daily summary" subscriber everything queued since their last digest. Run once a day. */
export async function sendDigests() {
  const [subscribers, pending] = await Promise.all([confirmedSubscribers(), pendingDigests()]);
  let sent = 0;
  const errors: string[] = [];
  for (const s of subscribers) {
    const items = pending.get(s.id) ?? [];
    if (!items.length) continue;
    try {
      await sendEmail(digestEmail(s, items));
      sent++;
      await clearDigest(s.id);
    } catch (e) {
      errors.push(`Digest to subscriber ${s.id}: ${(e as Error).message}`);
    }
  }
  return { sent, errors };
}
