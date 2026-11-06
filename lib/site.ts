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
 * Alert timing. Picks don't go out at one fixed time (sometimes 8:00, sometimes 8:30, sometimes
 * at the open), so the site never promises a clock time. The countdown counts to the US market
 * open (9:30 AM ET, weekdays), which is the latest a pick lands.
 */
export const alertTiming = {
  short: "Pre-market or at the open",
  long: "Picks land pre-market or right at the opening bell, depending on the setup.",
};
export const marketOpen = { hourET: 9, minuteET: 30, weekdaysOnly: true };

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
    features: [
      "Free stock picks by email and text",
      "Real-time press releases and SEC filings",
      "Follow any ticker: its news and filings sent to you",
      "Sponsored alerts, always labeled",
    ],
  },
  premium: {
    name: "Premium",
    price: 49,
    blurb: "Every pick we make, the moment we make it.",
    features: [
      "Every BigStocks pick, not just the free ones",
      "Short-term movers and long-term holds",
      "Instant text and email delivery",
      "Everything in Free",
      "Level 2 streaming (beta, early access)",
    ],
  },
} as const;
