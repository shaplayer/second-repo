import type { EmailProvider } from "../types";

/** Default: logs instead of sending. */
export const consoleEmail: EmailProvider = {
  name: "console",
  configured: () => true,
  async send(m) {
    console.log(`[email:console] to=${m.to.join(",")} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    return { id: `console-${Date.now()}` };
  },
};
