import type { SmsProvider } from "./types";
import { consoleProvider } from "./providers/console";
import { webhookProvider } from "./providers/webhook";
import { twilioProvider } from "./providers/twilio";

export type { SmsProvider, InboundMessage } from "./types";

/** Register new providers here, then set SMS_PROVIDER=<name>. */
const PROVIDERS: Record<string, SmsProvider> = {
  console: consoleProvider,
  webhook: webhookProvider,
  twilio: twilioProvider,
};

export function smsProvider(): SmsProvider {
  const name = (process.env.SMS_PROVIDER || "console").toLowerCase();
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown SMS_PROVIDER "${name}". Options: ${Object.keys(PROVIDERS).join(", ")}`);
  return p;
}

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
export const START_WORDS = ["START", "UNSTOP", "YES"];
