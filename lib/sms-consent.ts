/**
 * SMS program wording. Shown next to the checkbox AND stored with each
 * sign-up (TCPA / carrier requirements). If you change it, the new text is
 * what gets recorded for new sign-ups.
 */
export const SMS_PROGRAM = "BigStocks Alerts";

export const SMS_CONSENT_TEXT =
  "By checking this box, I agree to receive recurring automated marketing text messages (stock alerts) " +
  "from BigStocks at the number provided. Consent is not a condition of purchase. Message frequency varies. " +
  "Message and data rates may apply. Reply HELP for help or STOP to cancel.";

export const SMS_WELCOME =
  "BigStocks: You're in! Pre-market stock alerts will arrive by text. Msg freq varies. Msg & data rates may apply. " +
  "Reply HELP for help, STOP to cancel.";

export const SMS_FOOTER = "Reply STOP to opt out";

/** US numbers only for now. Returns E.164 (+1XXXXXXXXXX) or null. */
export function toE164US(input: string): string | null {
  const d = String(input ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null; // NANP area code + exchange
  return `+1${ten}`;
}
