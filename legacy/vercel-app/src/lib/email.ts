import type { Pick, Subscriber, Summary } from "./store";

// Emails go out through Resend (resend.com).
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const FROM = process.env.ALERT_FROM_EMAIL || "BigStocks Alerts <onboarding@resend.dev>";

type Mail = { to: string; subject: string; html: string; text: string; unsubscribeUrl?: string };

export function signInEmail(to: string, link: string): Mail {
  return {
    to,
    subject: "Your BigStocks sign-in link",
    html: `<!doctype html><html><body style="margin:0;background:#f3f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0b0f0d">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b0f0d;padding:14px 20px;font-size:20px;font-weight:900;color:#ffffff">Big<span style="color:#2ec274">Stocks</span></td></tr>
<tr><td style="padding:24px 20px">
<div style="font-size:20px;font-weight:700;margin-bottom:8px">Sign in to BigStocks</div>
<p style="line-height:1.5;margin:0 0 18px">Press the button to sign in. The link works once and expires in an hour.</p>
<a href="${link}" style="display:inline-block;background:#08884b;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Sign in</a>
<p style="font-size:12px;color:#59655f;line-height:1.5;margin:20px 0 0">If you didn’t ask to sign in, you can ignore this email. Nobody can sign in without this link.</p>
</td></tr></table></td></tr></table></body></html>`,
    text: `Sign in to BigStocks: ${link}\n\nThe link works once and expires in an hour. If you didn’t ask to sign in, ignore this email.`,
  };
}

export async function sendEmail(m: Mail) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is missing from .env");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      headers: m.unsubscribeUrl
        ? { "List-Unsubscribe": `<${m.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
        : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const links = (s: Subscriber) => ({
  confirm: `${APP_URL}/alerts/confirm?token=${s.token}`,
  manage: `${APP_URL}/alerts/manage?token=${s.token}`,
  unsubscribe: `${APP_URL}/api/alerts/unsubscribe?token=${s.token}`,
});

const TONE_COLOR: Record<Summary["tone"], string> = {
  "Good news": "#08884b",
  "Bad news": "#c3352b",
  Mixed: "#a86b10",
  Routine: "#59655f",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";

function layout(body: string, s: Subscriber) {
  const l = links(s);
  return `<!doctype html><html><body style="margin:0;background:#f3f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0b0f0d">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b0f0d;padding:14px 20px;font-size:20px;font-weight:900;color:#ffffff">Big<span style="color:#2ec274">Stocks</span></td></tr>
<tr><td style="padding:20px">${body}</td></tr>
<tr><td style="padding:14px 20px;border-top:1px solid #dde5e0;font-size:12px;color:#59655f;line-height:1.5">
Not investment advice. Summaries are written by AI from the company's official SEC filing and can contain mistakes; the original is linked above.<br>
<a href="${l.manage}" style="color:#59655f">Change alert settings</a> · <a href="${l.unsubscribe}" style="color:#59655f">Unsubscribe from all alerts</a>
</td></tr></table></td></tr></table></body></html>`;
}

function summaryBlock(x: Summary) {
  return `<div style="margin-bottom:20px">
<div style="font-size:12px;color:#59655f;margin-bottom:4px"><b style="color:#0b0f0d">${esc(x.ticker)}</b> · ${esc(x.companyName)} · ${when(x.accepted)}</div>
<div style="font-size:18px;font-weight:700;line-height:1.3;margin-bottom:6px">${esc(x.headline)}</div>
<div style="display:inline-block;font-size:12px;font-weight:700;color:${TONE_COLOR[x.tone]};border:1px solid ${TONE_COLOR[x.tone]};border-radius:999px;padding:1px 8px;margin-bottom:8px">${x.tone}</div>
<ul style="margin:0 0 8px;padding-left:20px;line-height:1.5">${x.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
<div style="background:#f3f6f4;border-radius:8px;padding:8px 12px;font-size:14px;line-height:1.5"><b>Why it matters:</b> ${esc(x.whyItMatters)}</div>
<div style="font-size:13px;margin-top:8px"><a href="${APP_URL}/stock/${encodeURIComponent(x.ticker)}?tab=filings" style="color:#08884b">See it on BigStocks</a> · <a href="${x.url}" style="color:#59655f">Original filing</a></div>
</div>`;
}

function summaryText(x: Summary) {
  return `${x.ticker} · ${x.companyName} · ${when(x.accepted)}\n${x.headline} (${x.tone})\n${x.bullets.map((b) => "- " + b).join("\n")}\nWhy it matters: ${x.whyItMatters}\nOriginal filing: ${x.url}`;
}

export function alertEmail(s: Subscriber, x: Summary): Mail {
  const l = links(s);
  return {
    to: s.email,
    subject: `${x.ticker}: ${x.headline}`,
    html: layout(summaryBlock(x), s),
    text: `${summaryText(x)}\n\nChange settings: ${l.manage}\nUnsubscribe: ${l.unsubscribe}`,
    unsubscribeUrl: l.unsubscribe,
  };
}

export function digestEmail(s: Subscriber, items: Summary[]): Mail {
  const l = links(s);
  const tickers = [...new Set(items.map((i) => i.ticker))].join(", ");
  return {
    to: s.email,
    subject: `Your daily BigStocks summary: ${items.length} update${items.length === 1 ? "" : "s"} (${tickers})`,
    html: layout(`<div style="font-size:15px;margin-bottom:16px">Here's everything your stocks filed today.</div>${items.map(summaryBlock).join("")}`, s),
    text: items.map(summaryText).join("\n\n") + `\n\nChange settings: ${l.manage}\nUnsubscribe: ${l.unsubscribe}`,
    unsubscribeUrl: l.unsubscribe,
  };
}

export function confirmEmail(s: Subscriber, ticker: string): Mail {
  const l = links(s);
  return {
    to: s.email,
    subject: `Confirm your BigStocks alerts for ${ticker}`,
    html: layout(
      `<div style="font-size:18px;font-weight:700;margin-bottom:8px">One click to turn on your alerts</div>
<p style="line-height:1.5;margin:0 0 16px">You asked for alerts about <b>${esc(ticker)}</b>. Press the button to confirm it's you. If you didn't ask for this, ignore this email and nothing will be sent.</p>
<a href="${l.confirm}" style="display:inline-block;background:#08884b;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Turn on alerts</a>`,
      s,
    ),
    text: `You asked for BigStocks alerts about ${ticker}. Confirm here: ${l.confirm}\n\nIf you didn't ask for this, ignore this email.`,
  };
}

/** The disclosure lines shown with every pick, on the site and in email. */
export function pickDisclosures(p: Pick): string[] {
  const lines: string[] = [];
  if (p.kind === "sponsored" && p.sponsor) {
    lines.push(`Paid advertisement. BigStocks received ${p.sponsor.amount} (${p.sponsor.form}) from ${p.sponsor.payer} to publish this. It is not an independent opinion.`);
  }
  lines.push(
    p.ownsShares
      ? `The writer or BigStocks owns shares of ${p.ticker} and may buy or sell them at any time, including while this post is active.${p.ownershipNote ? " " + p.ownershipNote : ""}`
      : `The writer and BigStocks did not own shares of ${p.ticker} when this was posted.`,
  );
  lines.push("Not personal investment advice. BigStocks and its writers are not registered investment advisers. Do your own research; you can lose money.");
  return lines;
}

export function pickEmail(s: Subscriber, p: Pick): Mail {
  const l = links(s);
  const sponsored = p.kind === "sponsored";
  const label = sponsored ? "ADVERTISEMENT · SPONSORED" : "BIGSTOCKS PICK";
  const disc = pickDisclosures(p);
  return {
    to: s.email,
    subject: `${sponsored ? "[Advertisement] " : "BigStocks Pick: "}${p.ticker}: ${p.title}`,
    html: layout(
      `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:${sponsored ? "#a86b10" : "#08884b"};margin-bottom:6px">${label}</div>
${sponsored ? `<div style="background:#fbf0dc;border-radius:8px;padding:10px 12px;font-size:14px;line-height:1.5;margin-bottom:12px"><b>${esc(disc[0])}</b></div>` : ""}
<div style="font-size:12px;color:#59655f;margin-bottom:4px"><b style="color:#0b0f0d">${esc(p.ticker)}</b> · ${esc(p.companyName)} · $${p.priceAtPost.toFixed(2)} when posted</div>
<div style="font-size:20px;font-weight:700;line-height:1.3;margin-bottom:8px">${esc(p.title)}</div>
<p style="line-height:1.6;margin:0 0 12px;white-space:pre-line">${esc(p.why)}</p>
<div style="font-size:13px;color:#59655f;margin-bottom:12px">By ${esc(p.author)}</div>
<a href="${APP_URL}/picks" style="color:#08884b;font-size:14px">See all picks and their results</a>
<div style="font-size:12px;color:#59655f;line-height:1.5;margin-top:14px">${disc.slice(sponsored ? 1 : 0).map(esc).join("<br>")}</div>`,
      s,
    ),
    text: `${label}\n${disc.join("\n")}\n\n${p.ticker} · ${p.companyName}\n${p.title}\n\n${p.why}\n\nBy ${p.author}\nAll picks: ${APP_URL}/picks\n\nChange settings: ${l.manage}\nUnsubscribe: ${l.unsubscribe}`,
    unsubscribeUrl: l.unsubscribe,
  };
}
