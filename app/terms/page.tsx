// DRAFT TEMPLATE awaiting the owner's lawyer. Do not reword: the owner fills in the [BRACKETS] and the lawyer approves the text.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The agreement between you and BigStocks for using the website and alerts.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updated="Last updated [DATE] · Effective [DATE]"
      intro="These terms are the agreement between you and [COMPANY LEGAL NAME] for using BigStocks, including the website, emails and text alerts. By using BigStocks you agree to them."
    >
      <LegalSection title="Who can use BigStocks">
        <p>
          You must be at least 18 and able to form a binding contract. BigStocks is offered from the United States; you are responsible for
          following the laws where you live.
        </p>
      </LegalSection>
      <LegalSection title="Your account">
        <p>
          You sign in with a link sent to your email. Keep access to your email secure; you are responsible for activity on your account. Tell
          us at [SUPPORT@EMAIL] if you think someone else used it.
        </p>
      </LegalSection>
      <LegalSection title="Free service">
        <p>
          BigStocks is free. We may add, change or remove features at any time. If we ever offer paid features, we will tell you the price and
          terms first.
        </p>
      </LegalSection>
      <LegalSection title="Not investment advice">
        <p>
          Everything on BigStocks is information only. Please read our <Link href="/disclaimer">Disclaimer</Link>, which is part of these terms.
        </p>
      </LegalSection>
      <LegalSection title="What you may not do">
        <ul>
          <li>Copy, scrape or resell our content or data, or use bots to collect it, without written permission.</li>
          <li>Interfere with the site, test its security without permission, or get around limits.</li>
          <li>Use BigStocks to break the law, including securities laws (for example, spreading false information to move a stock).</li>
          <li>Sign up someone else without their permission.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Content and ownership">
        <p>
          The BigStocks name, design, summaries and health check are ours. Filings, press releases and charts belong to their owners and are
          shown under their terms. You may share links and short quotes with credit.
        </p>
      </LegalSection>
      <LegalSection title="Third-party content and links">
        <p>
          We link to and show content from SEC EDGAR, newswires, Benzinga, Stock Titan, TradingView and others. We do not control and are not
          responsible for that content or those sites.
        </p>
      </LegalSection>
      <LegalSection title="Ending your use">
        <p>You can stop using BigStocks and unsubscribe at any time. We may suspend or close accounts that break these terms.</p>
      </LegalSection>
      <LegalSection title="Disclaimers and limits on liability">
        <p>
          BigStocks is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind. To the fullest extent the law
          allows, [COMPANY LEGAL NAME] is not liable for indirect, incidental or consequential damages, or for trading losses, and our total
          liability is limited to [$100].
        </p>
      </LegalSection>
      <LegalSection title="Disputes and governing law">
        <p>
          These terms are governed by the laws of [STATE], without regard to conflict-of-law rules. Disputes will be resolved in the courts of
          [COUNTY, STATE] [or by arbitration; describe if used].
        </p>
      </LegalSection>
      <LegalSection title="Changes to these terms">
        <p>
          We may update these terms. If changes are important, we will update the date above and tell you by email. Continuing to use BigStocks
          after that means you accept them.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
