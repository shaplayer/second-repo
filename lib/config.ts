/** Settings read from the environment, in one place. Nothing here is a secret. */

/** The site's public address, without a trailing slash. Used for links in emails. */
export const siteUrl = (env: NodeJS.ProcessEnv = process.env) =>
  (env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");

/**
 * The business postal address that the law (CAN-SPAM) requires in every alert email. Null when it is
 * missing or still the example value: alert emails are not sent until it is set.
 */
export function postalAddress(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.COMPANY_POSTAL_ADDRESS?.trim();
  if (!value || /123 Example St|City, ST 00000/i.test(value)) return null;
  return value;
}

/**
 * Text alerts are a later add-on (plan decision 15). While this is off the site shows no mobile
 * field, collects no phone number and sends no text. Leave it off until Twilio and the carrier
 * registration are ready.
 */
export const smsEnabled = (env: NodeJS.ProcessEnv = process.env) => env.SMS_ENABLED === "1";

/**
 * The separate health check rules for young, unprofitable companies (plan decision 9). Off until the
 * owner approves the proposal: until then every company is scored with the standard rules.
 */
export const growthRulesEnabled = (env: NodeJS.ProcessEnv = process.env) => env.HEALTH_GROWTH_RULES === "1";

/** Where sponsor inquiries and operational notices are emailed. */
export const teamInbox = (env: NodeJS.ProcessEnv = process.env) =>
  (env.INQUIRY_NOTIFY_TO ?? "").split(",").map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
