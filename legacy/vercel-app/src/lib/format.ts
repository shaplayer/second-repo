export const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

export const signed = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2);

/** $3.44T, $802B, $45M */
export function big(n: number | null | undefined, prefix = "$") {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(1)}M`;
  return `${sign}${prefix}${a.toLocaleString("en-US")}`;
}

export const upDown = (n: number) => (n >= 0 ? "up" : "dn");
