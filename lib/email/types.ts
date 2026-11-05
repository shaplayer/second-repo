/**
 * Email provider contract. Any service plugs in by implementing this and
 * registering it in lib/email/index.ts.
 */
export type EmailMessage = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export interface EmailProvider {
  /** Matches the EMAIL_PROVIDER env var. */
  name: string;
  configured(): boolean;
  /** Throw on failure. */
  send(msg: EmailMessage): Promise<{ id: string }>;
}
