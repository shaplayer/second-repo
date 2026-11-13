import Link from "next/link";

const LINKS = [
  { href: "/news", label: "Live news" },
  { href: "/picks", label: "Free picks" },
  { href: "/health-check", label: "Health check" },
  { href: "/advertise", label: "For public companies" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/terms", label: "Terms" },
  { href: "/sms-terms", label: "SMS terms" },
  { href: "/privacy", label: "Privacy" },
];

/** The same footer on every page: where the data comes from, and that none of it is advice. */
export function Footer() {
  return (
    <footer className="border-t border-line-soft">
      <div className="wrap flex flex-col gap-2.5 pb-10 pt-6">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-[22px] gap-y-1.5 text-sm font-semibold">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-ink-2 no-underline hover:text-ink">{l.label}</Link>
          ))}
        </nav>
        <p className="fine m-0">
          Filings and financials from SEC EDGAR; press releases from newswires and other sources. AI summaries can contain mistakes; each links to
          the original. Price data and charts by TradingView. Sponsored picks say who paid. Past picks do not guarantee future results. Not
          investment advice.
        </p>
      </div>
    </footer>
  );
}
