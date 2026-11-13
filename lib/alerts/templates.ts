/**
 * Every email the site sends, as plain text and HTML.
 *
 * Rules that hold for all of them:
 * - Plain English: "Quarterly report", never a form code on its own.
 * - Never "Buy" or "Sell". Every alert says it is not investment advice.
 * - An AI-written summary is labelled as AI-generated and links to the original.
 * - A sponsored pick says who paid, how much and in what form, at the top.
 * - No prices or price moves.
 * - Alert emails carry the postal address and working unsubscribe links (also as headers, so mail
 *   apps can show their own one-click button).
 */
import type { FeedItem } from "../data/feed";
import { sponsorLine, type StockPick } from "../data/picks";

export type EmailParts = { subject: string; text: string; html: string; headers?: Record<string, string> };

export type Footer = {
  /** The business postal address (required by law in alert emails). */
  postalAddress: string | null;
  /** Opens the page that asks what to stop. */
  unsubscribeUrl?: string;
  /** The address a mail app POSTs to for its own one-click unsubscribe button. */
  oneClickUrl?: string;
  /** Why this person is getting the email. */
  reason?: string;
  siteUrl: string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const INK = "#0c1a12";
const MUTED = "#4b5c52";
const GREEN = "#0f9a55";
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const button = (url: string, label: string) =>
  `<a href="${esc(url)}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:${INK};color:#ffffff;` +
  `text-decoration:none;font-weight:700;font-size:16px">${esc(label)}</a>`;

function layout(title: string, body: string, footer: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title></head>` +
    `<body style="margin:0;background:#f2faf5;font-family:${FONT};color:${INK}">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px">` +
    `<div style="font-weight:800;font-size:20px;letter-spacing:-0.02em;padding:0 4px 14px">BigStocks</div>` +
    `<div style="background:#ffffff;border-radius:20px;border:1px solid #e3ebe6;padding:26px 24px;font-size:16px;line-height:1.55">${body}</div>` +
    `<div style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${MUTED}">${footer}</div>` +
    `</div></body></html>`
  );
}

function footerText(f: Footer): string {
  const lines: string[] = [];
  if (f.reason) lines.push(f.reason);
  if (f.unsubscribeUrl) lines.push(`Unsubscribe: ${f.unsubscribeUrl}`);
  lines.push("Not investment advice.");
  lines.push(`BigStocks${f.postalAddress ? `, ${f.postalAddress}` : ""}`);
  return lines.join("\n");
}

function footerHtml(f: Footer): string {
  const parts: string[] = [];
  if (f.reason) parts.push(esc(f.reason));
  if (f.unsubscribeUrl) parts.push(`<a href="${esc(f.unsubscribeUrl)}" style="color:${MUTED}">Unsubscribe or change what you get</a>`);
  parts.push("Not investment advice.");
  parts.push(esc(`BigStocks${f.postalAddress ? `, ${f.postalAddress}` : ""}`));
  return parts.join("<br>");
}

function listHeaders(f: Footer): Record<string, string> | undefined {
  if (!f.oneClickUrl) return undefined;
  // RFC 8058: the mail app sends a POST to this address when the person presses its unsubscribe button.
  return { "List-Unsubscribe": `<${f.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/* ------------------------------------------------------- sign-up and sign-in */

export type ConfirmWants = { picks: boolean; companies: { ticker: string | null; name: string }[] };

const wantsText = (w: ConfirmWants) => {
  const parts: string[] = [];
  if (w.picks) parts.push("the free daily pick");
  const names = w.companies.map((c) => (c.ticker ? `$${c.ticker}` : c.name));
  if (names.length) parts.push(`alerts on ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}`);
  return parts.join(" and ") || "BigStocks alerts";
};

/** The double opt-in email: nothing else is sent until its link is used. */
export function confirmEmail(o: { confirmUrl: string; wants: ConfirmWants; footer: Footer }): EmailParts {
  const what = wantsText(o.wants);
  const subject = "Confirm your free BigStocks alerts";
  const text = [
    `You asked for ${what}.`,
    "",
    "Confirm that this is your address and we'll start sending:",
    o.confirmUrl,
    "",
    "If you didn't ask for this, ignore this email. You won't hear from us again.",
    "",
    footerText(o.footer),
  ].join("\n");
  const html = layout(
    subject,
    `<p style="margin:0 0 14px;font-size:20px;font-weight:800;line-height:1.25">Confirm your free BigStocks alerts</p>` +
      `<p style="margin:0 0 20px">You asked for ${esc(what)}. Confirm that this is your address and we'll start sending.</p>` +
      `<p style="margin:0 0 20px">${button(o.confirmUrl, "Yes, send me alerts")}</p>` +
      `<p style="margin:0;font-size:13px;color:${MUTED}">If you didn't ask for this, ignore this email. You won't hear from us again.</p>`,
    footerHtml(o.footer),
  );
  return { subject, text, html };
}

/** Sent when someone signs up with an address that is already getting those alerts. */
export function alreadySubscribedEmail(o: { manageUrl: string; footer: Footer }): EmailParts {
  const subject = "You're already getting BigStocks alerts";
  const text = [
    "Someone (probably you) just signed this address up for BigStocks alerts.",
    "You're already on the list, so there is nothing more to do.",
    "",
    `Change what you get, or stop: ${o.manageUrl}`,
    "",
    footerText(o.footer),
  ].join("\n");
  const html = layout(
    subject,
    `<p style="margin:0 0 14px;font-size:20px;font-weight:800;line-height:1.25">You're already on the list</p>` +
      `<p style="margin:0 0 20px">Someone (probably you) just signed this address up for BigStocks alerts. You're already getting them, so there is nothing more to do.</p>` +
      `<p style="margin:0">${button(o.manageUrl, "Change what I get")}</p>`,
    footerHtml(o.footer),
  );
  return { subject, text, html };
}

export function signInEmail(o: { url: string; minutes: number; footer: Footer }): EmailParts {
  const subject = "Your BigStocks sign-in link";
  const text = [
    "Use this link to sign in to BigStocks:",
    o.url,
    "",
    `It works once and expires in ${o.minutes} minutes.`,
    "If you didn't ask to sign in, ignore this email.",
    "",
    footerText(o.footer),
  ].join("\n");
  const html = layout(
    subject,
    `<p style="margin:0 0 14px;font-size:20px;font-weight:800;line-height:1.25">Sign in to BigStocks</p>` +
      `<p style="margin:0 0 20px">${button(o.url, "Sign in")}</p>` +
      `<p style="margin:0;font-size:13px;color:${MUTED}">The link works once and expires in ${o.minutes} minutes. If you didn't ask to sign in, ignore this email.</p>`,
    footerHtml(o.footer),
  );
  return { subject, text, html };
}

/* ------------------------------------------------------------------- alerts */

const tickerOf = (it: Pick<FeedItem, "ticker" | "company">) => (it.ticker ? `$${it.ticker}` : it.company);
const AI_LABEL = "AI-generated summary. Can contain mistakes.";

function itemText(it: FeedItem, site: string): string[] {
  const lines = [`${tickerOf(it)} · ${it.typeLabel} · ${it.sourceName}`, it.headline];
  if (it.summary) {
    if (it.summary.oneSentence && it.summary.oneSentence !== it.headline) lines.push("", it.summary.oneSentence);
    for (const b of it.summary.bullets) lines.push(`- ${b}`);
    if (it.summary.kind === "ai") lines.push("", AI_LABEL);
  }
  lines.push("", `Read the original on ${it.sourceName}: ${it.originalUrl}`, `On BigStocks: ${site}${it.path}`);
  return lines;
}

function itemHtml(it: FeedItem, site: string): string {
  let out =
    `<p style="margin:0 0 6px;font-size:13px;color:${MUTED}"><strong style="color:${INK};font-size:15px">${esc(tickerOf(it))}</strong> · ` +
    `<strong style="color:${GREEN}">${esc(it.typeLabel)}</strong> · ${esc(it.sourceName)}</p>` +
    `<p style="margin:0 0 14px;font-size:20px;font-weight:800;line-height:1.3"><a href="${esc(site + it.path)}" style="color:${INK};text-decoration:none">${esc(it.headline)}</a></p>`;
  if (it.summary) {
    out += `<div style="background:#f2faf5;border:1px solid #d6ece0;border-radius:14px;padding:16px 18px;margin:0 0 16px">`;
    if (it.summary.oneSentence && it.summary.oneSentence !== it.headline) {
      out += `<p style="margin:0 0 10px;font-weight:700">${esc(it.summary.oneSentence)}</p>`;
    }
    if (it.summary.bullets.length) {
      out += `<ul style="margin:0;padding-left:20px;color:#2c3d33">${it.summary.bullets.map((b) => `<li style="margin:0 0 4px">${esc(b)}</li>`).join("")}</ul>`;
    }
    if (it.summary.kind === "ai") out += `<p style="margin:10px 0 0;font-size:12px;color:${MUTED}">${AI_LABEL}</p>`;
    out += `</div>`;
  }
  out += `<p style="margin:0 0 4px"><a href="${esc(it.originalUrl)}" style="color:#0a6b3b;font-weight:700">Read the original on ${esc(it.sourceName)}</a></p>`;
  return out;
}

/** One alert about one filing or press release. */
export function alertEmail(o: { item: FeedItem; footer: Footer }): EmailParts {
  const it = o.item;
  const subject = `${tickerOf(it)}: ${it.headline}`.slice(0, 180);
  const text = [...itemText(it, o.footer.siteUrl), "", footerText(o.footer)].join("\n");
  const html = layout(subject, itemHtml(it, o.footer.siteUrl), footerHtml(o.footer));
  return { subject, text, html, headers: listHeaders(o.footer) };
}

/** The daily summary for people who chose one email a day. */
export function digestEmail(o: { items: FeedItem[]; footer: Footer }): EmailParts {
  const n = o.items.length;
  const names = [...new Set(o.items.map(tickerOf))];
  const subject = `${n} new ${n === 1 ? "post" : "posts"} on your stocks: ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}`.slice(0, 180);
  const text = [
    `Today on your stocks (${n}):`,
    "",
    ...o.items.flatMap((it) => [...itemText(it, o.footer.siteUrl), "", "----", ""]),
    footerText(o.footer),
  ].join("\n");
  const html = layout(
    subject,
    `<p style="margin:0 0 18px;font-size:13px;font-weight:800;letter-spacing:0.08em;color:#0a5f34">TODAY ON YOUR STOCKS</p>` +
      o.items.map((it) => itemHtml(it, o.footer.siteUrl)).join(`<hr style="border:0;border-top:1px solid #edf2ef;margin:20px 0">`),
    footerHtml(o.footer),
  );
  return { subject, text, html, headers: listHeaders(o.footer) };
}

/** The free pick, or a sponsored pick. A sponsored one says who paid before anything else. */
export function pickEmail(o: { pick: StockPick; footer: Footer }): EmailParts {
  const p = o.pick;
  const paid = sponsorLine(p);
  const page = `${o.footer.siteUrl}/picks`;
  const stock = `${o.footer.siteUrl}/stock/${encodeURIComponent(p.ticker)}`;
  const subject = `${p.sponsored ? "Sponsored" : "Today's free pick"}: $${p.ticker}`;
  const text = [
    ...(paid ? [paid, ""] : []),
    `$${p.ticker} · ${p.company}`,
    p.title,
    ...(p.why ? ["", p.why] : []),
    ...(p.sourceUrl ? ["", `The source: ${p.sourceUrl}`] : []),
    "",
    `The $${p.ticker} page: ${stock}`,
    `Every pick: ${page}`,
    "",
    ...(paid ? [] : ["Not sponsored. No one paid for this pick."]),
    "Picks are ideas to research, not advice.",
    "",
    footerText(o.footer),
  ].join("\n");
  const html = layout(
    subject,
    (paid
      ? `<p style="margin:0 0 16px;padding:12px 14px;border-radius:12px;background:#fdf0d6;color:#734805;font-size:14px;font-weight:700">${esc(paid)}</p>`
      : `<p style="margin:0 0 10px;font-size:13px;font-weight:800;letter-spacing:0.08em;color:#0a5f34">TODAY'S FREE PICK</p>`) +
      `<p style="margin:0 0 6px;font-size:15px;color:${MUTED}"><strong style="color:${INK};font-size:22px">$${esc(p.ticker)}</strong> · ${esc(p.company)}</p>` +
      `<p style="margin:0 0 14px;font-size:20px;font-weight:800;line-height:1.3">${esc(p.title)}</p>` +
      (p.why ? `<p style="margin:0 0 16px;color:#2c3d33">${esc(p.why)}</p>` : "") +
      (p.sourceUrl ? `<p style="margin:0 0 16px"><a href="${esc(p.sourceUrl)}" style="color:#0a6b3b;font-weight:700">Read the source</a></p>` : "") +
      `<p style="margin:0 0 16px">${button(stock, `See the $${p.ticker} page`)}</p>` +
      `<p style="margin:0;font-size:13px;color:${MUTED}">${paid ? "" : "Not sponsored. No one paid for this pick. "}Picks are ideas to research, not advice.</p>`,
    footerHtml(o.footer),
  );
  return { subject, text, html, headers: listHeaders(o.footer) };
}
