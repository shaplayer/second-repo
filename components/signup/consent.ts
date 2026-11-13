/**
 * The exact wording shown beside every sign-up button. The same text is stored with the sign-up as
 * the record of what the person agreed to, so change it here and nowhere else.
 */
export const EMAIL_CONSENT =
  "We'll email you a link to confirm. Free; unsubscribe any time. Sponsored picks always say who paid. Not investment advice.";

/** The full sentence shown under a sign-up button, and stored word for word with the sign-up. */
export function consentFor(ticker: string | null | undefined, picks: boolean): string {
  const what = ticker ? (picks ? `Alerts on $${ticker}, plus the free daily pick. ` : `Alerts on $${ticker}. `) : "";
  return what + EMAIL_CONSENT;
}

/** Used when a signed-in person switches alerts on for a stock from their own account. */
export const SIGNED_IN_CONSENT = "Turned on email alerts while signed in to BigStocks. Unsubscribe any time.";
