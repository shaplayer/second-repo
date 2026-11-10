import type { PoolClient } from "pg";
import { db, hasDb } from "./db";
import { emailProvider, type EmailMessage } from "./email";
import { smsProvider } from "./sms";
import { SMS_FOOTER } from "./sms-consent";
import { formatPrice } from "./format";
import { normalizeTicker } from "./feeds/tickers";
import { site } from "./follow/messages";

/**
 * Alert broadcasts: log an alert on the permanent track record and send it to the list.
 *
 *   createAlert()      → inserts the alert (timestamped now) + a queued broadcast
 *   processBroadcasts() → sends queued broadcasts in batches, resumable (site + ingest worker both call it)
 *
 * Free alerts go to everyone on the list. Premium alerts go to premium members only.
 */

export type Tier = "free" | "premium";
export type Channel = "email" | "sms";
export type NewAlert = {
  ticker: string; price: number; tier: Tier; message?: string | null;
  sponsored?: boolean; sponsorComp?: string | null; channels: Channel[];
  /** Log on the track record but don't send (e.g. sent from another tool). */
  logOnly?: boolean;
};

const LOCK_ID = 74_219_002;
const EMAIL_BATCH = 100;
const EMAIL_BATCHES_PER_SEC = Number(process.env.EMAIL_BATCHES_PER_SEC ?? 2); // Resend's default API limit
const SMS_RATE_PER_SEC = Number(process.env.SMS_RATE_PER_SEC ?? 10);
const UNSUB = "{{UNSUB}}";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Who gets it: SQL filter for each channel. */
const audienceSql = (channel: Channel, tier: Tier) =>
  `general_alerts AND unsubscribed_at IS NULL AND ${channel === "email" ? "email IS NOT NULL" : "phone IS NOT NULL AND sms_consent"}` +
  (tier === "premium" ? " AND premium" : "");

export async function audienceCounts(): Promise<Record<Tier, Record<Channel, number>>> {
  const q = async (c: Channel, t: Tier) => Number((await db().query(`SELECT count(*) FROM subscribers WHERE ${audienceSql(c, t)}`)).rows[0].count);
  const [fe, fs, pe, ps] = await Promise.all([q("email", "free"), q("sms", "free"), q("email", "premium"), q("sms", "premium")]);
  return { free: { email: fe, sms: fs }, premium: { email: pe, sms: ps } };
}

/** The messages for one alert. Same wording on every channel. */
export function buildMessages(a: { ticker: string; price: number; tier: Tier; message?: string | null; sponsored?: boolean; sponsorComp?: string | null; at: Date }) {
  const label = a.tier === "premium" ? "BigStocks Premium Pick" : "BigStocks Alert";
  const page = `${site()}/news/${encodeURIComponent(a.ticker)}`;
  const when = a.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  const note = a.message?.trim() ?? "";
  const disclosure = a.sponsored ? `Sponsored: ${a.sponsorComp}` : "";
  const address = process.env.COMPANY_POSTAL_ADDRESS?.trim();

  const subject = `${label}: $${a.ticker}`;
  const text = [
    `${label}: $${a.ticker} at ${formatPrice(a.price)} (${when})`,
    ...(note ? ["", note] : []),
    "",
    `News, filings and chart: ${page}`,
    ...(disclosure ? ["", disclosure] : []),
    "",
    "Not investment advice. Do your own research.",
    `Unsubscribe from alert emails: ${UNSUB}`,
    ...(address ? [address] : []),
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#0b0f10">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e3e8e5">
<tr><td style="padding:28px 28px 8px">
<p style="margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0a9c55;font-weight:700">${esc(label)}</p>
<p style="margin:10px 0 0;font-size:30px;font-weight:700;font-family:ui-monospace,Menlo,monospace">$${esc(a.ticker)}</p>
<p style="margin:6px 0 0;font-size:15px;color:#4a5358">Alert price <strong style="color:#0b0f10">${esc(formatPrice(a.price))}</strong> · ${esc(when)}</p>
${note ? `<p style="margin:18px 0 0;font-size:15px;line-height:1.55">${esc(note).replace(/\n/g, "<br>")}</p>` : ""}
<p style="margin:22px 0 0"><a href="${page}" style="display:inline-block;background:#12e27a;color:#04130b;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">See $${esc(a.ticker)} news &amp; filings</a></p>
${disclosure ? `<p style="margin:20px 0 0;font-size:13px;color:#4a5358"><strong>${esc(disclosure)}</strong></p>` : ""}
</td></tr>
<tr><td style="padding:20px 28px 26px;font-size:12px;line-height:1.6;color:#7a8489">
Not investment advice. Do your own research.<br>
<a href="${UNSUB}" style="color:#7a8489">Unsubscribe from alert emails</a>${address ? `<br>${esc(address)}` : ""}
</td></tr></table></td></tr></table></body></html>`;

  const smsNote = note ? ` ${note.replace(/\s+/g, " ").slice(0, 140)}` : "";
  const sms = `${label}: $${a.ticker} at ${formatPrice(a.price)}.${smsNote} ${page}` + (disclosure ? `\n${disclosure}` : "") + `\n${SMS_FOOTER}`;
  return { subject, text, html, sms };
}

/** Validate, log the alert on the track record, and queue the send. */
export async function createAlert(input: NewAlert): Promise<{ alertId: string; broadcastId: string | null }> {
  if (!hasDb()) throw new Error("Database not configured");
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) throw new Error("Enter a valid ticker.");
  if (!(input.price > 0)) throw new Error("Alert price must be more than $0.");
  if (input.tier !== "free" && input.tier !== "premium") throw new Error("Tier must be free or premium.");
  const comp = input.sponsorComp?.trim() || null;
  if (input.sponsored && !comp) throw new Error("Sponsored alerts need the compensation disclosure.");
  const channels = (input.channels ?? []).filter((c) => c === "email" || c === "sms");
  if (!input.logOnly && !channels.length) throw new Error("Pick email, text, or both.");
  const message = input.message?.trim().slice(0, 1000) || null;

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO alerts (ticker, alerted_at, alert_price, sponsored, sponsor_comp, tier, message)
       VALUES ($1, now(), $2, $3, $4, $5, $6) RETURNING id, alerted_at`,
      [ticker, input.price, Boolean(input.sponsored), input.sponsored ? comp : null, input.tier, message],
    );
    const alertId = String(rows[0].id);
    let broadcastId: string | null = null;
    if (!input.logOnly) {
      const m = buildMessages({ ticker, price: input.price, tier: input.tier, message, sponsored: input.sponsored, sponsorComp: comp, at: new Date(rows[0].alerted_at) });
      const b = await client.query(
        `INSERT INTO broadcasts (alert_id, tier, channels, subject, text_body, html_body, sms_body) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [alertId, input.tier, channels, m.subject, m.text, m.html, m.sms],
      );
      broadcastId = String(b.rows[0].id);
    }
    await client.query("COMMIT");
    return { alertId, broadcastId };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

type Row = { id: string; tier: Tier; channels: Channel[]; subject: string; text_body: string; html_body: string; sms_body: string; email_cursor: string; sms_cursor: string };

/** Send everything queued. Safe to call from several processes: one sender at a time. */
export async function processBroadcasts(): Promise<number> {
  if (!hasDb()) return 0;
  const client = await db().connect();
  let done = 0;
  try {
    if (!(await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_ID])).rows[0].ok) return 0;
    try {
      for (;;) {
        const b: Row | undefined = (await client.query(
          `SELECT * FROM broadcasts WHERE status IN ('queued','sending') ORDER BY id LIMIT 1`,
        )).rows[0];
        if (!b) break;
        await client.query(`UPDATE broadcasts SET status = 'sending' WHERE id = $1`, [b.id]);
        // Texts first: they're the fast channel. A problem with one channel doesn't stop the other.
        const errors: string[] = [];
        for (const ch of (["sms", "email"] as const).filter((c) => b.channels.includes(c))) {
          try { await (ch === "sms" ? sendSms(client, b) : sendEmails(client, b)); }
          catch (e) { errors.push(`${ch}: ${(e as Error).message}`); console.error(`[broadcast ${b.id}] ${ch}:`, (e as Error).message); }
        }
        await client.query(
          `UPDATE broadcasts SET status = $2, error = $3, finished_at = now() WHERE id = $1`,
          [b.id, errors.length === b.channels.length ? "failed" : "done", errors.length ? errors.join("; ").slice(0, 500) : null],
        );
        done++;
      }
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_ID]);
    }
  } finally {
    client.release();
  }
  return done;
}

type Client = PoolClient;

async function sendEmails(client: Client, b: Row) {
  const mail = emailProvider();
  if (!mail.configured()) throw new Error(`Email provider "${mail.name}" is not configured (set EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM)`);
  let cursor = Number(b.email_cursor);
  for (;;) {
    const started = Date.now();
    const { rows } = await client.query<{ id: string; email: string; unsub_token: string }>(
      `SELECT id, email, unsub_token FROM subscribers WHERE ${audienceSql("email", b.tier)} AND id > $1 ORDER BY id LIMIT ${EMAIL_BATCH}`,
      [cursor],
    );
    if (!rows.length) return;
    const msgs: EmailMessage[] = rows.map((r) => {
      const page = `${site()}/unsubscribe?t=${r.unsub_token}`;
      const oneClick = `${site()}/api/unsubscribe?t=${r.unsub_token}`;
      return {
        to: [r.email], subject: b.subject,
        text: b.text_body.replaceAll(UNSUB, page), html: b.html_body.replaceAll(UNSUB, page),
        headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    });
    let sent = 0, failed = 0;
    if (mail.sendBatch) {
      try { await mail.sendBatch(msgs); sent = msgs.length; }
      catch (e) { failed = msgs.length; console.error(`[broadcast ${b.id}] email batch failed:`, (e as Error).message); }
    } else {
      for (const m of msgs) {
        try { await mail.send(m); sent++; } catch { failed++; }
      }
    }
    cursor = Number(rows[rows.length - 1].id);
    await client.query(
      `UPDATE broadcasts SET email_cursor = $2, emails_sent = emails_sent + $3, failed = failed + $4 WHERE id = $1`,
      [b.id, cursor, sent, failed],
    );
    const wait = 1000 / EMAIL_BATCHES_PER_SEC - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
}

async function sendSms(client: Client, b: Row) {
  const sms = smsProvider();
  if (!sms.configured()) throw new Error(`SMS provider "${sms.name}" is not configured`);
  const gap = 1000 / SMS_RATE_PER_SEC;
  let cursor = Number(b.sms_cursor);
  for (;;) {
    const { rows } = await client.query<{ id: string; phone: string }>(
      `SELECT id, phone FROM subscribers WHERE ${audienceSql("sms", b.tier)} AND id > $1 ORDER BY id LIMIT 200`,
      [cursor],
    );
    if (!rows.length) return;
    let sent = 0, failed = 0;
    for (const r of rows) {
      const started = Date.now();
      try { await sms.send(r.phone, b.sms_body); sent++; }
      catch (e) { failed++; console.error(`[broadcast ${b.id}] sms ${r.phone.slice(0, -4)}XXXX:`, (e as Error).message); }
      const wait = gap - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    }
    cursor = Number(rows[rows.length - 1].id);
    await client.query(
      `UPDATE broadcasts SET sms_cursor = $2, texts_sent = texts_sent + $3, failed = failed + $4 WHERE id = $1`,
      [b.id, cursor, sent, failed],
    );
  }
}

export type BroadcastStatus = {
  id: string; alertId: string | null; ticker: string | null; tier: Tier; channels: Channel[]; status: string;
  emailsSent: number; textsSent: number; failed: number; error: string | null; createdAt: string; finishedAt: string | null;
};

export async function recentBroadcasts(limit = 15): Promise<BroadcastStatus[]> {
  if (!hasDb()) return [];
  const { rows } = await db().query(
    `SELECT b.*, a.ticker FROM broadcasts b LEFT JOIN alerts a ON a.id = b.alert_id ORDER BY b.id DESC LIMIT $1`, [limit],
  );
  return rows.map((r) => ({
    id: String(r.id), alertId: r.alert_id ? String(r.alert_id) : null, ticker: r.ticker, tier: r.tier, channels: r.channels,
    status: r.status, emailsSent: r.emails_sent, textsSent: r.texts_sent, failed: r.failed, error: r.error,
    createdAt: new Date(r.created_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  }));
}
