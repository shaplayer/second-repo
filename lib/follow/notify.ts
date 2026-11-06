import { db, hasDb } from "../db";
import { emailProvider } from "../email";
import { smsProvider } from "../sms";
import { followEmail, followSms, type Update } from "./messages";

/** Only tell followers about things that are actually new (not a backfill). */
const FRESH = "2 hours";
const LOCK_ID = 74_219_001; // advisory lock: one dispatcher at a time across processes
const SMS_RATE_PER_SEC = Number(process.env.SMS_RATE_PER_SEC ?? 10);

type Follower = { id: string; channel: "email" | "sms"; token: string; email: string | null; phone: string | null };

/**
 * Tell followers of each ticker about new press releases, filings and BigStocks alerts.
 * Safe to call from several places (ingest worker, alert API): a database lock makes sure
 * only one run sends at a time, and every item is marked so nobody is told twice.
 */
export async function dispatchFollowNotifications(): Promise<{ tickers: number; emails: number; texts: number; failed: number }> {
  const out = { tickers: 0, emails: 0, texts: 0, failed: 0 };
  if (!hasDb()) return out;
  const client = await db().connect();
  try {
    const got = (await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_ID])).rows[0].ok;
    if (!got) return out;
    try {
      const news = (await client.query(
        `SELECT id, ticker, company, kind, form_type, title, url, source, published_at FROM news_items
          WHERE notified_at IS NULL AND ticker IS NOT NULL AND ingested_at > now() - interval '${FRESH}'
          ORDER BY published_at LIMIT 1000`,
      )).rows;
      const alerts = (await client.query(
        `SELECT id, ticker, alert_price, sponsored, sponsor_comp FROM alerts
          WHERE notified_at IS NULL AND created_at > now() - interval '${FRESH}' ORDER BY alerted_at LIMIT 200`,
      )).rows;
      if (!news.length && !alerts.length) return out;

      // Group by ticker; stale items (published long before we saw them) are marked, not sent.
      const fresh = (r: { published_at: Date }) => Date.now() - new Date(r.published_at).getTime() < 2 * 3600_000;
      const byTicker = new Map<string, { update: Update; newsIds: string[]; alertIds: string[] }>();
      const get = (t: string) => {
        if (!byTicker.has(t)) byTicker.set(t, { update: { ticker: t, company: null, news: [], alerts: [] }, newsIds: [], alertIds: [] });
        return byTicker.get(t)!;
      };
      const staleNews: string[] = [];
      for (const r of news) {
        if (!fresh(r)) { staleNews.push(String(r.id)); continue; }
        const g = get(r.ticker);
        g.newsIds.push(String(r.id));
        g.update.company ??= r.company;
        g.update.news.push({ kind: r.kind, formType: r.form_type, title: r.title, url: r.url, source: r.source });
      }
      for (const r of alerts) {
        const g = get(r.ticker);
        g.alertIds.push(String(r.id));
        g.update.alerts.push({ alertPrice: Number(r.alert_price), sponsored: r.sponsored, sponsorComp: r.sponsor_comp });
      }
      if (staleNews.length) await client.query(`UPDATE news_items SET notified_at = now() WHERE id = ANY($1)`, [staleNews]);

      const mail = emailProvider();
      const sms = smsProvider();
      for (const [ticker, g] of byTicker) {
        const followers: Follower[] = (await client.query(
          `SELECT f.id, f.channel, f.token, s.email, s.phone FROM ticker_follows f JOIN subscribers s ON s.id = f.subscriber_id
            WHERE f.ticker = $1 AND f.confirmed_at IS NOT NULL AND f.unsubscribed_at IS NULL
              AND (f.channel = 'email' OR s.unsubscribed_at IS NULL)`,
          [ticker],
        )).rows;
        // Keep each message to a readable size.
        g.update.news = g.update.news.slice(-5);

        if (followers.length) out.tickers++;
        const smsBody = followSms(g.update);
        for (const f of followers) {
          try {
            if (f.channel === "email" && f.email && mail.configured()) {
              await mail.send(followEmail(g.update, f.email, f.token));
              out.emails++;
            } else if (f.channel === "sms" && f.phone && sms.configured()) {
              const t0 = Date.now();
              await sms.send(f.phone, smsBody);
              out.texts++;
              const wait = 1000 / SMS_RATE_PER_SEC - (Date.now() - t0);
              if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            } else continue;
            await client.query(`UPDATE ticker_follows SET last_notified_at = now() WHERE id = $1`, [f.id]);
          } catch (e) {
            out.failed++;
            console.error(`[follow] ${f.channel} for $${ticker} failed:`, (e as Error).message);
          }
        }
        // Mark as processed even if a single send failed, so nobody gets duplicates on the next pass.
        if (g.newsIds.length) await client.query(`UPDATE news_items SET notified_at = now() WHERE id = ANY($1)`, [g.newsIds]);
        if (g.alertIds.length) await client.query(`UPDATE alerts SET notified_at = now() WHERE id = ANY($1)`, [g.alertIds]);
      }
      return out;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_ID]);
    }
  } finally {
    client.release();
  }
}
