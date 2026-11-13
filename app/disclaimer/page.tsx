// DRAFT TEMPLATE awaiting the owner's lawyer. Do not reword: the owner fills in the [BRACKETS] and the lawyer approves the text.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalPage, LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Disclaimer",
  description: "BigStocks publishes news, plain-English summaries, a health check and free stock picks. It is information, not advice.",
};

export default function DisclaimerPage() {
  return (
    <LegalPage
      title="Disclaimer"
      updated="Last updated [DATE] · Effective [DATE]"
      intro="BigStocks publishes news, plain-English summaries, a health check and free stock picks. It is information, not advice. Please read this before you act on anything you see here."
    >
      <LegalSection title="Not investment advice">
        <LegalCallout>Nothing on BigStocks, in our emails or in our texts is a recommendation to buy, sell or hold any security.</LegalCallout>
        <p>
          [COMPANY LEGAL NAME] is not a registered investment adviser or broker-dealer. We do not know your finances, goals or risk tolerance.
          Talk to a licensed professional before you invest.
        </p>
      </LegalSection>
      <LegalSection title="Free picks">
        <p>
          Our free picks are ideas to research, chosen by our team using public information. They are not personal recommendations. Stocks,
          especially small and young companies, can lose most or all of their value.
        </p>
        <p>Past picks do not guarantee future results.</p>
      </LegalSection>
      <LegalSection title="Sponsored content and compensation">
        <p>
          Some news, alerts and picks are paid for by the company featured or a third party. Every paid item is labeled &quot;Sponsored&quot; and
          says who paid, how much and in what form, as Section 17(b) of the Securities Act requires.
        </p>
        <ul>
          <li>Sponsored items are never mixed with or counted as our free picks.</li>
          <li>We do not trade a stock we are paid to feature [for X days before and after]. [Describe your policy.]</li>
          <li>[COMPANY LEGAL NAME], its owners and staff may hold positions in securities mentioned. [Describe your holdings policy.]</li>
        </ul>
      </LegalSection>
      <LegalSection title="News, filings and AI summaries">
        <p>
          We show press releases and SEC filings from SEC EDGAR, newswires, Benzinga, Stock Titan and other sources. We do not write them and
          are not responsible for what companies say in them.
        </p>
        <p>
          Plain-English summaries are written by AI and can contain mistakes or leave out important details. Each one links to the original.
          Always read the original before acting.
        </p>
      </LegalSection>
      <LegalSection title="Health check">
        <p>
          The health check is a simple Strong, Mixed or Weak result calculated from a company&apos;s own SEC financial data. It describes past
          filings only. It is not a rating of the stock, does not predict its price and can be wrong if the filings are wrong or late.
        </p>
      </LegalSection>
      <LegalSection title="Prices and data">
        <p>
          Prices and charts are provided by TradingView and may be delayed. Data can be incomplete, late or inaccurate. We make no promise that
          anything on the site is complete, current or error-free.
        </p>
      </LegalSection>
      <LegalSection title="Forward-looking statements">
        <p>
          Press releases and filings often contain forward-looking statements about plans and expectations. These are the company&apos;s, not
          ours, and actual results can differ greatly.
        </p>
      </LegalSection>
      <LegalSection title="Your responsibility">
        <p>
          You are solely responsible for your investment decisions. To the fullest extent the law allows, [COMPANY LEGAL NAME] is not liable for
          any loss from using or relying on BigStocks. See our <Link href="/terms">Terms of use</Link> for the full terms.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
