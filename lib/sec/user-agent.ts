/**
 * Who we tell the SEC we are.
 *
 * The SEC asks every automated client to send a User-Agent with a company name and a monitored
 * contact email, and it blocks clients that don't ("Undeclared Automated Tool"). So there is no
 * default: if SEC_USER_AGENT is missing or still a placeholder, we stop instead of sending a made-up
 * identity.  https://www.sec.gov/os/accessing-edgar-data
 */

const PLACEHOLDER = /yourdomain|example\.(com|org|net)|your-?company|company name|monitored email|\[|\]/i;
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;

export class SecUserAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecUserAgentError";
  }
}

/** Returns the reason a value can't be used, or null when it is fine. */
export function secUserAgentProblem(value: string | undefined | null): string | null {
  const ua = (value ?? "").trim();
  if (!ua) return "SEC_USER_AGENT is not set";
  if (PLACEHOLDER.test(ua)) return "SEC_USER_AGENT is still a placeholder";
  if (!EMAIL.test(ua)) return "SEC_USER_AGENT has no contact email";
  if (ua.replace(EMAIL, "").replace(/[^A-Za-z]/g, "").length < 2) return "SEC_USER_AGENT has no company name";
  if (/[\r\n]/.test(ua) || ua.length > 200) return "SEC_USER_AGENT must be one short line";
  return null;
}

/** The User-Agent for every request to sec.gov. Throws when it isn't a real one. */
export function secUserAgent(env: Record<string, string | undefined> = process.env): string {
  const problem = secUserAgentProblem(env.SEC_USER_AGENT);
  if (problem) {
    throw new SecUserAgentError(
      `${problem}. Set it to your company name and a monitored email, for example: ` +
        `SEC_USER_AGENT="Acme Research LLC sec-contact@acme-research.com"`,
    );
  }
  return env.SEC_USER_AGENT!.trim();
}
