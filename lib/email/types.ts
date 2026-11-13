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
  /** Extra headers, e.g. List-Unsubscribe / List-Unsubscribe-Post (one-click unsubscribe). */
  headers?: Record<string, string>;
};

export interface EmailProvider {
  /** Matches the EMAIL_PROVIDER env var. */
  name: string;
  configured(): boolean;
  /**
   * Throw on failure. `idempotencyKey`: sending again with the same key must not produce a second
   * email (used when a send is retried after an unclear failure). Providers that cannot do this ignore it.
   */
  send(msg: EmailMessage, opts?: { idempotencyKey?: string }): Promise<{ id: string }>;
  /** Optional: send many at once (alert broadcasts). Falls back to send() one by one. All or nothing: throw if the batch was not accepted. */
  sendBatch?(msgs: EmailMessage[], opts?: { idempotencyKey?: string }): Promise<{ ids: string[] } | void>;
}
