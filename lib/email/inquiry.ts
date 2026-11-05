import { PACKAGES, formatUSD } from "../advertise";
import type { EmailMessage } from "./types";

export type Inquiry = {
  id?: string | null;
  name: string; company: string; email: string;
  ticker: string | null; phone: string | null; package: string | null; message: string | null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Team notification for a new Advertise-form request. Reply goes straight to the company. */
export function inquiryEmail(q: Inquiry, to: string[]): EmailMessage {
  const pkg = PACKAGES.find((p) => p.id === q.package);
  const pkgLabel = pkg ? `${pkg.name}: ${formatUSD(pkg.price)} ${pkg.cadence}` : "Not sure yet";
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://bigstocks.com").replace(/\/$/, "");
  const rows: [string, string][] = [
    ["Company", q.company],
    ["Ticker", q.ticker ?? "-"],
    ["Name", q.name],
    ["Email", q.email],
    ["Phone", q.phone ?? "-"],
    ["Package", pkgLabel],
    ["Message", q.message ?? "-"],
  ];
  const subject = `New campaign request: ${q.company}${q.ticker ? ` ($${q.ticker})` : ""}, ${pkg ? pkg.name : "package not chosen"}`;
  const text =
    `New campaign request from the BigStocks Advertise page.\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nReply to this email to answer ${q.name} directly.` +
    (q.ticker ? `\nTheir news page: ${site}/news/${q.ticker}` : "") +
    (q.id ? `\nInquiry #${q.id}` : "");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#0b0f10">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e7e5">
    <tr><td style="background:#07090a;padding:18px 24px;color:#f4f6f5;font-weight:800;letter-spacing:.08em;font-size:15px">BIG<span style="color:#12e27a">STOCKS</span></td></tr>
    <tr><td style="padding:24px 24px 8px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0fb863">New campaign request</div>
      <div style="font-size:22px;font-weight:700;margin-top:6px">${esc(q.company)}${q.ticker ? ` <span style="font-family:Menlo,monospace;color:#5b646a">$${esc(q.ticker)}</span>` : ""}</div>
      <div style="font-size:15px;color:#5b646a;margin-top:4px">${esc(pkgLabel)}</div>
    </td></tr>
    <tr><td style="padding:12px 24px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
      ${rows.filter(([k]) => k !== "Message").map(([k, v]) => `<tr><td style="padding:8px 0;color:#5b646a;width:90px;vertical-align:top;border-top:1px solid #eef1f0">${k}</td><td style="padding:8px 0;border-top:1px solid #eef1f0">${esc(v)}</td></tr>`).join("")}
    </table></td></tr>
    ${q.message ? `<tr><td style="padding:8px 24px 4px"><div style="font-size:13px;color:#5b646a;margin-bottom:6px">Message</div><div style="white-space:pre-wrap;font-size:14px;line-height:1.5;background:#f4f6f5;border-radius:10px;padding:12px 14px">${esc(q.message)}</div></td></tr>` : ""}
    <tr><td style="padding:18px 24px 24px">
      <a href="mailto:${esc(q.email)}" style="display:inline-block;background:#12e27a;color:#04130b;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:14px">Reply to ${esc(q.name)}</a>
      ${q.ticker ? `<a href="${site}/news/${encodeURIComponent(q.ticker)}" style="display:inline-block;margin-left:8px;color:#0b0f10;font-size:14px">View their news page →</a>` : ""}
    </td></tr>
  </table>
  <div style="font-size:12px;color:#8b949a;margin-top:12px">Sent by bigstocks.com${q.id ? ` · Inquiry #${esc(q.id)}` : ""}</div>
  </td></tr></table></body></html>`;

  return { to, subject, text, html, replyTo: q.email };
}
