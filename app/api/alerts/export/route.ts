import { listAlerts, pct } from "@/lib/alerts";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Full public track record as CSV: anyone can check our math. */
export async function GET() {
  const head = ["id", "alerted_at_utc", "logged_at_utc", "ticker", "alert_price", "high_after", "high_pct", "close_after", "close_pct", "result", "sponsored", "sponsor_compensation"];
  const lines = [head.join(",")];
  for (let page = 1; ; page++) {
    const { rows } = await listAlerts({}, page, 1000);
    for (const a of rows) {
      lines.push([
        a.id, a.alertedAt, a.loggedAt, a.ticker, a.alertPrice, a.highAfter, pct(a.alertPrice, a.highAfter)?.toFixed(2),
        a.closeAfter, pct(a.alertPrice, a.closeAfter)?.toFixed(2), a.result, a.sponsored, a.sponsorComp,
      ].map(esc).join(","));
    }
    if (rows.length < 1000) break;
  }
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bigstocks-track-record.csv"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
