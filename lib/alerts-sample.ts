import type { AlertResult, AlertRow } from "./alerts";

/**
 * Example alerts for previewing the track record on your own computer (FEED_SAMPLE=1).
 * Fictional tickers, never stored in the database and never shown in production.
 */
type Seed = [ticker: string, daysAgo: number, hhmmET: string, price: number, high: number | null, close: number | null, opts?: { sponsored?: string; premium?: boolean }];

const SEEDS: Seed[] = [
  ["VORB", 0, "08:41", 3.12, null, null, { premium: true }],
  ["NWBT", 0, "08:12", 1.84, 2.31, null],
  ["HGRD", 1, "09:02", 6.4, 7.95, 7.62],
  ["SLVP", 1, "08:30", 2.05, 2.18, 1.97, { sponsored: "BigStocks was paid $5,000 by Silverpeak Therapeutics for this alert." }],
  ["CPLMF", 2, "08:47", 0.82, 1.19, 1.04],
  ["BWPY", 3, "09:28", 12.1, 14.85, 13.9, { premium: true }],
  ["KTRX", 4, "08:15", 4.5, 4.62, 4.21],
  ["ALMD", 5, "08:55", 0.46, 0.71, 0.63],
  ["QNTL", 6, "09:10", 9.8, 11.4, 10.95],
  ["DRGN", 7, "08:20", 1.33, 1.39, 1.33],
  ["ORBX", 8, "08:44", 5.75, 7.2, 6.86, { premium: true }],
  ["FLXR", 9, "09:25", 2.6, 2.74, 2.41],
  ["MRSH", 10, "08:05", 0.95, 1.38, 1.21],
];

/** Most recent first. Times are relative to today (ET, weekdays only), so the page always looks current. */
export function sampleAlerts(now = new Date()): AlertRow[] {
  const out: AlertRow[] = [];
  // Trading days (US Eastern calendar), most recent first.
  const etDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const today = new Date(`${etDate(now)}T12:00:00Z`);
  const dayFor = new Map<number, Date>();
  for (let i = 0, back = 0; back <= 12 && i < 40; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    dayFor.set(back++, d);
  }
  const etOffset = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(d)
      .find((x) => x.type === "timeZoneName")?.value ?? "GMT-5";
    return Number(p.replace("GMT", "")) || -5;
  };
  SEEDS.forEach(([ticker, back, hhmm, price, high, close, opts], i) => {
    const d = dayFor.get(back)!;
    const [h, m] = hhmm.split(":").map(Number);
    const ymd = d.toISOString().slice(0, 10);
    const at = new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    at.setUTCHours(at.getUTCHours() - etOffset(at));
    const premium = Boolean(opts?.premium);
    const reveal = new Date(`${ymd}T16:00:00Z`);
    reveal.setUTCHours(reveal.getUTCHours() - etOffset(reveal));
    const hidden = premium && now < reveal;
    const result: AlertResult = close == null ? "open" : close > price ? "win" : close < price ? "loss" : "flat";
    out.push({
      id: `sample-${i}`, ticker: hidden ? "" : ticker, alertedAt: at.toISOString(), loggedAt: at.toISOString(),
      alertPrice: hidden ? 0 : price, highAfter: hidden ? null : high, closeAfter: hidden ? null : close,
      result: hidden ? "open" : result, sponsored: Boolean(opts?.sponsored), sponsorComp: hidden ? null : opts?.sponsored ?? null,
      notes: null, tier: premium ? "premium" : "free", hidden,
    });
  });
  return out.filter((a) => new Date(a.alertedAt) <= now).sort((a, b) => b.alertedAt.localeCompare(a.alertedAt));
}
