/** Times as visitors read them. New York time throughout: it is the time the market and the SEC use. */

const NY = "America/New_York";

/** "14 s", "3 m", "2 h", "Yesterday", "Nov 3". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} m`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 172800) return "Yesterday";
  return dayET(iso);
}

/** "8:14 AM" */
export const clockET = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: NY });

/** "Nov 10" */
export const dayET = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: NY });

/** "Nov 10, 2026" */
export const dateET = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: NY });

/** "Today, 8:14:22 AM ET" or "Nov 10, 8:14:22 AM ET": the exact time something was published. */
export function exactET(iso: string, now = Date.now()): string {
  const day = (t: number | string) => new Date(t).toLocaleDateString("en-US", { timeZone: NY });
  const time = new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: NY });
  return `${day(iso) === day(now) ? "Today" : dayET(iso)}, ${time} ET`;
}

/** "$212M", "$1.4B", "$950K": company-reported amounts (never a share price). */
export function money(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}
