/**
 * Single source of truth for links and site-wide numbers.
 * Swap placeholder URLs via env vars (no code change needed) or edit here.
 */
export const links = {
  // Existing pages you already built. Set these env vars on the server.
  level2: process.env.NEXT_PUBLIC_LEVEL2_URL || "/level-2",
  alerts: process.env.NEXT_PUBLIC_ALERTS_URL || "/alerts",
  // Pages coming in later phases.
  news: "/news",
  filings: "/filings",
  trackRecord: "/track-record",
  advertise: "/advertise",
  signup: "#signup",
} as const;

export const isExternal = (href: string) => /^https?:\/\//.test(href);

/** Only verified numbers go here. Sponsors will check them. */
export const audience = {
  emailSubscribers: 125_000,
  dailyImpressions: 1_000_000,
  dailyClicks: 5_000,
};

/**
 * Pre-market alert schedule used by the homepage countdown.
 * Times are US Eastern. Adjust to match your real alert send time.
 */
export const alertSchedule = {
  hourET: Number(process.env.NEXT_PUBLIC_ALERT_HOUR_ET ?? 8),
  minuteET: Number(process.env.NEXT_PUBLIC_ALERT_MINUTE_ET ?? 0),
  weekdaysOnly: true,
};

export const nav = [
  { label: "Alerts", href: links.alerts },
  { label: "News", href: links.news },
  { label: "Filings", href: links.filings },
  { label: "Track Record", href: links.trackRecord },
  { label: "Level 2", href: links.level2 },
  { label: "Advertise", href: links.advertise },
];
