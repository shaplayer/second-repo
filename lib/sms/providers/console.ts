import type { SmsProvider } from "../types";

/** Default: sends nothing, logs instead. Safe for development and before a provider is chosen. */
export const consoleProvider: SmsProvider = {
  name: "console",
  configured: () => true,
  async send(to, body) {
    console.log(`[sms:console] to=${to.slice(0, -4)}XXXX body=${JSON.stringify(body)}`);
    return { id: `console-${Date.now()}` };
  },
};
