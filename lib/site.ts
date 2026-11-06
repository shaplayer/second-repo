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
  premium: "/premium",
  // Your devs' checkout (PayPal, crypto…). Until it's set, Premium buttons open /premium (waitlist form).
  premiumCheckout: process.env.NEXT_PUBLIC_PREMIUM_CHECKOUT_URL || "",
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
 * Alert timing. Picks don't go out at one fixed time (8:00, 8:30, at the open, or during market hours
 * if a setup pops up), so the site never promises one clock time. The homepage countdown counts to
 * the start of the 8:00–9:30 AM ET pick window.
 */
export const alertTiming = {
  short: "Pre-market or at the open",
  long: "Picks land pre-market or right at the opening bell, depending on the setup.",
};
/** The pick window, US Eastern: 8:00 AM to the 9:30 AM opening bell, trading days only (see lib/schedule.ts). */
export const alertWindow = { startHourET: 8, startMinuteET: 0, endHourET: 9, endMinuteET: 30 };

export const nav = [
  { label: "Stock Alerts", href: links.alerts },
  { label: "News", href: links.news },
  { label: "SEC Filings", href: links.filings },
  { label: "Track Record", href: links.trackRecord },
  { label: "Premium", href: links.premium },
];

/** Plans. Payment is wired up by the dev team via NEXT_PUBLIC_PREMIUM_CHECKOUT_URL. */
export const plans = {
  free: {
    name: "Free",
    price: 0,
    blurb: "Great picks and breaking news, free forever.",
    cadence: "Picks several times a week",
    features: [
      "Free stock picks several times a week",
      "Real-time press releases and SEC filings",
      "Follow any ticker: its news and filings sent to you",
      "Text and email delivery, in seconds",
      "Sponsored alerts, always labeled",
    ],
  },
  premium: {
    name: "Premium",
    price: 49,
    blurb: "Our highest-conviction picks. Fewer picks, more research behind each one.",
    cadence: "About 1 to 4 picks a month",
    features: [
      "Everything in Free",
      "Premium picks: our highest-conviction ideas, not sent to Free",
      "About 1 to 4 a month. We wait for the best setups",
      "Short-term setups and longer-term holds",
      "Level 2 streaming (beta, early access)",
    ],
  },
} as const;
