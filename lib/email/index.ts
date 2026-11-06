import type { EmailProvider } from "./types";
import { consoleEmail } from "./providers/console";
import { smtpEmail } from "./providers/smtp";
import { webhookEmail } from "./providers/webhook";

export type { EmailMessage, EmailProvider } from "./types";

/** Register new providers here, then set EMAIL_PROVIDER=<name>. */
const PROVIDERS: Record<string, EmailProvider> = { console: consoleEmail, smtp: smtpEmail, webhook: webhookEmail };

export function emailProvider(): EmailProvider {
  const name = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown EMAIL_PROVIDER "${name}". Options: ${Object.keys(PROVIDERS).join(", ")}`);
  return p;
}

/** Comma-separated team inbox(es) that get notified, e.g. "sales@bigstocks.com,you@bigstocks.com". */
export const notifyRecipients = () =>
  (process.env.INQUIRY_NOTIFY_TO ?? "").split(",").map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
