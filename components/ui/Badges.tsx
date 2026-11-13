import type { Category } from "@/lib/plain";

/** One tint per kind of news, as in the approved design. */
const TONE: Record<Category, string> = {
  press: "bg-good-bg text-good",
  earnings: "bg-blue-bg text-blue",
  news: "bg-blue-bg text-blue",
  insider: "bg-amber-bg text-amber",
  ipo: "bg-violet-bg text-violet",
  proxy: "bg-blue-bg text-blue",
};
const TEXT: Record<Category, string> = {
  press: "text-good", earnings: "text-blue", news: "text-blue", insider: "text-amber", ipo: "text-violet", proxy: "text-blue",
};

/** "Press release", "Quarterly report", "Insider trade"… as a small pill. */
export function TypeBadge({ category, label, className = "" }: { category: Category; label: string; className?: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-extrabold ${TONE[category]} ${className}`}>{label}</span>;
}

/** The same label as plain coloured text, for dense lists. */
export function TypeText({ category, label, className = "" }: { category: Category; label: string; className?: string }) {
  return <span className={`text-[13px] font-extrabold ${TEXT[category]} ${className}`}>{label}</span>;
}

const VERDICT: Record<string, string> = {
  Strong: "bg-good-bg text-good",
  Mixed: "bg-amber-bg text-amber",
  Weak: "bg-bad-bg text-bad",
};

/** Strong / Mixed / Weak, or "No score yet". Never Buy or Sell. */
export function HealthPill({ verdict, className = "" }: { verdict: "Strong" | "Mixed" | "Weak" | null; className?: string }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[13px] font-extrabold ${verdict ? VERDICT[verdict] : "bg-chip text-muted"} ${className}`}>
      {verdict ?? "No score yet"}
    </span>
  );
}

const COLORS = ["#0f9a55", "#2a6fdb", "#c27a0e", "#7a4fd6", "#c2410c", "#0e7490"];

/** A coloured tile with the company's initials (no logos are fetched from anywhere). */
export function Initials({ name, ticker, size = 48 }: { name: string; ticker?: string | null; size?: number }) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const text = (ticker ? ticker.slice(0, 2) : (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden="true" className="flex flex-none items-center justify-center font-extrabold text-white"
      style={{ width: size, height: size, borderRadius: Math.round(size / 3), background: COLORS[h % COLORS.length], fontSize: Math.round(size / 3) }}>
      {text}
    </span>
  );
}
