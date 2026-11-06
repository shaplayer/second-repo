/**
 * Sponsor packages shown on /advertise and the homepage teaser.
 * Edit prices and deliverables here: one place, used everywhere.
 */
export type Package = {
  id: "ongoing" | "spotlight" | "sponsorship";
  name: string;
  price: number;
  cadence: string;           // shown after the price
  summary: string;
  includes: string[];
  featured?: boolean;
};

export const PACKAGES: Package[] = [
  {
    id: "ongoing",
    name: "Ongoing Presence",
    price: 10_000,
    cadence: "/ month",
    summary: "Steady, month-after-month visibility for your company with our audience.",
    includes: [
      "Ongoing featured placement on BigStocks.com",
      "Your press releases highlighted in our News & Filings feed",
      "Mentions in our subscriber emails",
      "Month-to-month",
    ],
  },
  {
    id: "spotlight",
    name: "Press Release Spotlight",
    price: 47_000,
    cadence: "one-time",
    summary: "One press release, published and alerted to our full list.",
    includes: [
      "1 press release published on BigStocks.com",
      "Dedicated alert to 125,000 email subscribers",
      "Pinned at the top of our News & Filings feed",
      "Clearly disclosed as sponsored",
    ],
  },
  {
    id: "sponsorship",
    name: "Full Sponsorship",
    price: 250_000,
    cadence: "/ month",
    summary: "The whole nine yards: every channel, all month long.",
    includes: [
      "Everything in Press Release Spotlight",
      "Email and SMS text alerts to our subscribers",
      "Ongoing marketing and media distribution",
      "Featured across BigStocks.com all month",
      "Reach across 1M+ daily impressions",
    ],
    featured: true,
  },
];

export const formatUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
