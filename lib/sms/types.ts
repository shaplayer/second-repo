/**
 * SMS provider contract. Any texting service (Twilio, Telnyx, Plivo, Vonage,
 * Bandwidth, your own gateway…) plugs in by implementing this interface and
 * registering it in lib/sms/index.ts.
 */
export type InboundMessage = { from: string; body: string };

export interface SmsProvider {
  /** Matches the SMS_PROVIDER env var. */
  name: string;
  /** True when the env vars this provider needs are present. */
  configured(): boolean;
  /** Send one text. `to` is E.164 (+15555550123). Throw on failure. */
  send(to: string, body: string): Promise<{ id: string }>;
  /**
   * Parse (and authenticate!) an inbound-message webhook hitting /api/sms/inbound.
   * Return null to reject the request with 403.
   */
  parseInbound?(req: Request): Promise<InboundMessage | null>;
  /** Optional response body/content-type the provider expects from the webhook. */
  inboundResponse?(): Response;
}
