import type { EmailMessage } from "../email/types";
import { formatPrice } from "../format";
import { SMS_FOOTER } from "../sms-consent";

export type NewsNote = { kind: "press" | "filing"; formType: string | null; title: string; url: string; source: string };
export type AlertNote = { alertPrice: number; sponsored: boolean; sponsorComp: string | null };
export type Update = { ticker: string; company: string | null; news: NewsNote[]; alerts: AlertNote[] };

export const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://bigstocks.com").replace(/\/$/, "");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const label = (n: NewsNote) => (n.kind === "filing" ? `${n.formType ?? "SEC"} filing` : "Press release");

function headline(u: Update): string {
  if (u.alerts.length) return `BigStocks alert: $${u.ticker}`;
  if (u.news.length === 1) return `$${u.ticker}: new ${label(u.news[0]).toLowerCase()}`;
  return `$${u.ticker}: ${u.news.length} new updates`;
}

const alertLine = (a: AlertNote, t: string) =>
  `Free stock alert: $${t} at ${formatPrice(a.alertPrice)}.` + (a.sponsored ? ` Sponsored: ${a.sponsorComp}` : "");

/** One email per follower (each has its own unsubscribe link). */
export function followEmail(u: Update, to: string, token: string): EmailMessage {
  const page = `${site()}/news/${encodeURIComponent(u.ticker)}`;
  const unsubPage = `${site()}/follow/unsubscribe?t=${token}`;
  const oneClick = `${site()}/api/follow/unsubscribe?t=${token}`;
  const address = process.env.COMPANY_POSTAL_ADDRESS?.trim();

  const text = [
    `${headline(u)}${u.company ? ` (${u.company})` : ""}`,
    "",
    ...u.alerts.map((a) => alertLine(a, u.ticker)),
    ...u.news.map((n) => `${label(n)}: ${n.title}\n${n.url}`),
    "",
    `Everything for $${u.ticker}: ${page}`,
    "Not investment advice.",
    "",
    `You follow $${u.ticker} on BigStocks. Unsubscribe from $${u.ticker} emails: ${unsubPage}`,
    ...(address ? [address] : []),
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#0b0f10">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e7e5">
  <tr><td style="background:#07090a;padding:18px 24px;color:#f4f6f5;font-weight:800;letter-spacing:.08em;font-size:15px">BIG<span style="color:#12e27a">STOCKS</span></td></tr>
  <tr><td style="padding:24px 24px 6px">
    <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0fb863">${u.alerts.length ? "Free stock alert" : "Company update"}</div>
    <div style="font-size:24px;font-weight:700;margin-top:6px;font-family:Menlo,monospace">$${esc(u.ticker)}</div>
    ${u.company ? `<div style="font-size:15px;color:#5b646a;margin-top:2px">${esc(u.company)}</div>` : ""}
  </td></tr>
  ${u.alerts.map((a) => `<tr><td style="padding:10px 24px 0"><div style="background:#eafcf2;border:1px solid #b9f2d2;border-radius:10px;padding:12px 14px;font-size:15px">
    <b>Alert price ${esc(formatPrice(a.alertPrice))}</b>${a.sponsored ? `<div style="font-size:12px;color:#5b646a;margin-top:6px"><b>SPONSORED</b> · ${esc(a.sponsorComp ?? "")}</div>` : ""}</div></td></tr>`).join("")}
  ${u.news.map((n) => `<tr><td style="padding:12px 24px 0">
    <div style="font-size:12px;color:${n.kind === "filing" ? "#2b6cb0" : "#0fb863"};font-weight:600">${esc(label(n))} · ${esc(n.source)}</div>
    <a href="${esc(n.url)}" style="display:block;margin-top:3px;font-size:15px;line-height:1.4;color:#0b0f10;text-decoration:none;font-weight:600">${esc(n.title)}</a></td></tr>`).join("")}
  <tr><td style="padding:20px 24px 24px">
    <a href="${page}" style="display:inline-block;background:#12e27a;color:#04130b;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:14px">See all $${esc(u.ticker)} news &amp; filings</a>
    <div style="font-size:12px;color:#8b949a;margin-top:14px">Not investment advice.</div>
  </td></tr>
</table>
<div style="font-size:12px;color:#8b949a;margin-top:12px;line-height:1.6">You follow $${esc(u.ticker)} on BigStocks. <a href="${unsubPage}" style="color:#8b949a">Unsubscribe from $${esc(u.ticker)} emails</a>${address ? `<br>${esc(address)}` : ""}</div>
</td></tr></table></body></html>`;

  return {
    to: [to],
    subject: `${headline(u)}${u.news[0] && !u.alerts.length ? ` · ${u.news[0].title.slice(0, 70)}` : ""}`,
    text,
    html,
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

/** One text per follower, kept short (~1-2 SMS segments). */
export function followSms(u: Update): string {
  const page = `${site().replace(/^https?:\/\//, "")}/news/${u.ticker}`;
  let body: string;
  if (u.alerts.length) body = `BigStocks: ${alertLine(u.alerts[0], u.ticker)}`;
  else {
    const n = u.news[u.news.length - 1]; // newest
    const more = u.news.length > 1 ? ` (+${u.news.length - 1} more)` : "";
    body = `BigStocks: $${u.ticker} ${n.kind === "filing" ? `filed a ${n.formType}` : "news"}: ${n.title}${more}`;
  }
  const tail = ` ${page} ${SMS_FOOTER}`;
  const max = 300 - tail.length;
  return (body.length > max ? body.slice(0, max - 1) + "…" : body) + tail;
}

export function confirmEmail(ticker: string, to: string, token: string): EmailMessage {
  const url = `${site()}/api/follow/confirm?t=${token}`;
  const address = process.env.COMPANY_POSTAL_ADDRESS?.trim();
  return {
    to: [to],
    subject: `Confirm your $${ticker} alerts from BigStocks`,
    text: `Confirm you want emails when $${ticker} issues news or SEC filings, or when BigStocks sends a free alert on it:\n\n${url}\n\nIf you didn't ask for this, ignore this email and you won't hear from us.${address ? `\n\n${address}` : ""}`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#0b0f10">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e7e5">
  <tr><td style="background:#07090a;padding:18px 24px;color:#f4f6f5;font-weight:800;letter-spacing:.08em;font-size:15px">BIG<span style="color:#12e27a">STOCKS</span></td></tr>
  <tr><td style="padding:26px 24px">
    <div style="font-size:21px;font-weight:700">Confirm your <span style="font-family:Menlo,monospace">$${esc(ticker)}</span> alerts</div>
    <p style="font-size:15px;line-height:1.5;color:#5b646a">You'll get an email when $${esc(ticker)} issues a press release or SEC filing, or when BigStocks sends a free alert on it.</p>
    <a href="${url}" style="display:inline-block;background:#12e27a;color:#04130b;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:15px">Confirm alerts</a>
    <p style="font-size:12px;color:#8b949a;margin-top:18px">Didn't ask for this? Ignore this email and you won't hear from us.</p>
  </td></tr>
</table>${address ? `<div style="font-size:12px;color:#8b949a;margin-top:12px">${esc(address)}</div>` : ""}
</td></tr></table></body></html>`,
  };
}
