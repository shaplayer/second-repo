import { links } from "@/lib/site";
import { SmartLink } from "../SmartLink";
import { Wordmark } from "../Wordmark";

const COLS = [
  { title: "Product", items: [["Pre-market alerts", links.alerts], ["Level 2 Streaming", links.level2], ["Track record", links.trackRecord]] },
  { title: "Research", items: [["News", links.news], ["SEC filings", links.filings]] },
  { title: "Company", items: [["Advertise", links.advertise], ["Contact", `${links.advertise}#contact`], ["SMS terms", "/sms-terms"]] },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface/40">
      <div className="container-wide py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-muted">
              Free pre-market stock alerts from in-house scanners, plus a live feed of every press release and SEC filing.
            </p>
          </div>
          {COLS.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">{c.title}</p>
              <ul className="mt-4 space-y-2.5">
                {c.items.map(([label, href]) => (
                  <li key={label}><SmartLink href={href} className="text-[14px] text-muted transition-colors hover:text-ink">{label}</SmartLink></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 space-y-3 border-t border-line pt-8 text-[12px] leading-relaxed text-faint">
          <p>
            <strong className="font-semibold text-muted">Not investment advice.</strong> BigStocks publishes stock alerts and market
            information for educational and informational purposes only. We are not a registered investment adviser or broker-dealer.
            Trading stocks involves risk, including loss of principal. Past performance does not guarantee future results. Do your own research.
          </p>
          <p>
            <strong className="font-semibold text-muted">Sponsored content disclosure.</strong> BigStocks may be compensated by companies
            to feature them in alerts or on this site. All paid placements are labeled &quot;Sponsored&quot;, and the compensation received
            is disclosed with each one, in accordance with Section 17(b) of the Securities Act of 1933.
          </p>
          <p>
            Filings data from SEC EDGAR. Press releases from their original newswire, linked at the source. Data may be delayed.
          </p>
          <p className="pt-2">© {new Date().getFullYear()} BigStocks. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
