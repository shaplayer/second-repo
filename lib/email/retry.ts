import { db, hasDb } from "../db";
import { emailProvider, notifyRecipients } from "./index";
import { inquiryEmail } from "./inquiry";

/**
 * Re-send team notifications that failed (notified_at IS NULL), for inquiries
 * from the last 3 days. Run by the ingest worker on every pass.
 */
export async function retryInquiryNotifications(): Promise<{ sent: number; failed: number }> {
  const mail = emailProvider();
  const to = notifyRecipients();
  if (!hasDb() || !to.length || !mail.configured() || mail.name === "console") return { sent: 0, failed: 0 };
  const { rows } = await db().query(
    `SELECT id, name, company, email, ticker, phone, package, message FROM inquiries
      WHERE notified_at IS NULL AND created_at > now() - interval '3 days' ORDER BY id LIMIT 20`,
  );
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      await mail.send(inquiryEmail({ ...r, id: String(r.id) }, to));
      await db().query(`UPDATE inquiries SET notified_at = now() WHERE id = $1`, [r.id]);
      sent++;
    } catch (e) {
      failed++;
      console.error(`[inquiry-retry] #${r.id} failed:`, (e as Error).message);
      break; // provider is likely down; try again next pass
    }
  }
  return { sent, failed };
}
