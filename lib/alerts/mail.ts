/**
 * The two emails that are sent straight away rather than through the alert queue: the sign-up
 * confirmation and the sign-in link. Both go to an address someone typed, so both are capped per
 * address and per visitor: the forms must not be usable to flood a stranger's inbox.
 */
import type { Client, Pool, PoolClient } from "pg";
import { createLoginToken, LOGIN_LINK_MINUTES } from "../auth/accounts";
import { postalAddress, siteUrl } from "../config";
import { emailProvider, type EmailProvider } from "../email";
import { allow, LIMITS } from "../limits";
import { isSuppressed, noteConfirmationSent, peekConfirmation } from "./subscriptions";
import { alreadySubscribedEmail, confirmEmail, signInEmail, type EmailParts, type Footer } from "./templates";

type Db = Pool | PoolClient | Client;

const footer = (): Footer => ({ siteUrl: siteUrl(), postalAddress: postalAddress() });
const send = (provider: EmailProvider, to: string, p: EmailParts) =>
  provider.send({ to: [to], subject: p.subject, text: p.text, html: p.html });

export type MailResult = "sent" | "limited" | "nothing-to-send";

/** Sends (or re-sends) the confirmation email for a sign-up that is waiting. */
export async function sendConfirmation(
  db: Db, confirmToken: string, opts: { visitor: string | null; provider?: EmailProvider },
): Promise<MailResult> {
  const view = await peekConfirmation(db, confirmToken);
  if (!view || !view.waiting.length) return "nothing-to-send";
  if (!(await allow(db, LIMITS.signupPerVisitor, opts.visitor ?? "unknown"))) return "limited";
  if (!(await allow(db, LIMITS.signupPerAddress, view.email))) return "limited";
  if (!(await noteConfirmationSent(db, confirmToken))) return "limited";
  const wants = {
    picks: view.waiting.some((w) => w.cik === null),
    companies: view.waiting.filter((w) => w.cik !== null).map((w) => ({ ticker: w.ticker, name: w.company ?? "" })),
  };
  const confirmUrl = `${siteUrl()}/confirm?token=${encodeURIComponent(confirmToken)}`;
  await send(opts.provider ?? emailProvider(), view.email, confirmEmail({ confirmUrl, wants, footer: footer() }));
  return "sent";
}

/** Tells someone who signed up again that they are already on the list (so the form never reveals who is subscribed). */
export async function sendAlreadySubscribed(db: Db, email: string, opts: { visitor: string | null; provider?: EmailProvider }): Promise<MailResult> {
  if (await isSuppressed(db, email)) return "nothing-to-send";
  if (!(await allow(db, LIMITS.signupPerVisitor, opts.visitor ?? "unknown"))) return "limited";
  if (!(await allow(db, LIMITS.signupPerAddress, email))) return "limited";
  await send(opts.provider ?? emailProvider(), email, alreadySubscribedEmail({ manageUrl: `${siteUrl()}/sign-in?next=/settings`, footer: footer() }));
  return "sent";
}

/** Emails a one-time sign-in link. */
export async function sendSignInLink(
  db: Db, email: string, opts: { nextPath?: string | null; visitor: string | null; provider?: EmailProvider },
): Promise<MailResult> {
  if (!(await allow(db, LIMITS.signInPerVisitor, opts.visitor ?? "unknown"))) return "limited";
  if (!(await allow(db, LIMITS.signInPerAddress, email))) return "limited";
  const token = await createLoginToken(db, email, { nextPath: opts.nextPath, ip: opts.visitor });
  const url = `${siteUrl()}/auth/callback?token=${encodeURIComponent(token)}`;
  await send(opts.provider ?? emailProvider(), email, signInEmail({ url, minutes: LOGIN_LINK_MINUTES, footer: footer() }));
  return "sent";
}
