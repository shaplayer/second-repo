"use client";
import { openAlerts } from "./AlertsDialog";
import { Bell } from "./Icons";

/**
 * The alerts bell. Pulses so people notice it; one click opens the pop-up.
 * variant="icon": round button (top menu, feed rows). variant="pill": bell + label (next to the news).
 */
export function BellButton({ ticker, source, variant = "pill", label, className = "" }: {
  ticker?: string; source?: string; variant?: "icon" | "pill" | "row"; label?: string; className?: string;
}) {
  const text = label ?? (ticker ? `Alert me on $${ticker}` : "Get news alerts");
  const aria = ticker ? `Get $${ticker} news and filing alerts` : "Get stock alerts and news by email or text";
  const click = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); openAlerts({ ticker, source }); };

  if (variant === "row") {
    return (
      <button type="button" onClick={click} aria-label={aria} title={aria}
        className={`relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line text-faint transition-colors hover:border-brand/50 hover:bg-brand/10 hover:text-brand ${className}`}>
        <Bell className="h-4 w-4" />
      </button>
    );
  }

  if (variant === "icon") {
    return (
      <button type="button" onClick={click} aria-label={aria} title="Get alerts"
        className={`bell-halo relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand/40 bg-brand/10 text-brand transition-colors hover:bg-brand/20 ${className}`}>
        <Bell className="h-[18px] w-[18px] animate-bell-ring" />
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand ring-2 ring-bg" />
      </button>
    );
  }

  return (
    <button type="button" onClick={click} aria-label={aria}
      className={`bell-halo relative inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-brand/50 bg-brand/10 pl-3 pr-4 text-[13.5px] font-semibold text-brand transition-colors hover:bg-brand/20 ${className}`}>
      <Bell className="h-4 w-4 animate-bell-ring" />
      <span className="whitespace-nowrap">{text}</span>
    </button>
  );
}
