// DRAFT TEMPLATE awaiting the owner's lawyer. Do not reword: the owner fills in the [BRACKETS] and the lawyer approves the text.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalPage, LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What BigStocks collects when you use the site or sign up for alerts, why, who we share it with, and the choices you have.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="Last updated [DATE] · Effective [DATE]"
      intro="This policy explains what we collect when you use BigStocks or sign up for alerts, why, who we share it with, and the choices you have."
    >
      <LegalSection title="What we collect">
        <ul>
          <li><strong>What you give us:</strong> email address, mobile number, the stocks you follow and your alert settings.</li>
          <li><strong>Consent records:</strong> the exact sign-up and text-message consent wording you agreed to, with the date, time, IP address and page.</li>
          <li><strong>Automatically:</strong> device and browser type, IP address, pages viewed, and whether you open our emails or click their links.</li>
          <li><strong>From companies (For public companies form):</strong> name, email, phone number, company and message.</li>
        </ul>
      </LegalSection>
      <LegalSection title="How we use it">
        <ul>
          <li>Send the alerts, picks and emails you asked for.</li>
          <li>Confirm your sign-up (double opt-in) and keep proof of consent.</li>
          <li>Run, secure and improve the site and fix problems.</li>
          <li>Measure which pages and alerts are useful, in aggregate.</li>
          <li>Reply to companies that contact us about sponsorship.</li>
          <li>Meet legal duties, such as handling STOP requests and record keeping.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Who we share it with">
        <LegalCallout>We do not sell your personal information, and we do not share your phone number with sponsors.</LegalCallout>
        <p>We share it only with service providers who help us run BigStocks, under contracts that limit their use of it:</p>
        <ul>
          <li>Email delivery: [EMAIL PROVIDER]</li>
          <li>Text messages: [SMS PROVIDER]</li>
          <li>Hosting and database: [HOSTING PROVIDER], [DATABASE PROVIDER]</li>
          <li>Analytics: [ANALYTICS PROVIDER, if any]</li>
          <li>Price charts: TradingView (its widgets may set their own cookies)</li>
        </ul>
        <p>
          We may also disclose information if the law requires it, to protect our rights or users, or as part of a sale or merger of the
          business.
        </p>
      </LegalSection>
      <LegalSection title="Cookies">
        <p>
          We use cookies needed to keep you signed in and remember your settings, and [analytics cookies]. Embedded TradingView charts may set
          their own cookies. You can block cookies in your browser; some features may stop working.
        </p>
      </LegalSection>
      <LegalSection title="Your choices">
        <ul>
          <li>Change what you get, or turn off email or text, in <Link href="/settings">Alert settings</Link>.</li>
          <li>Unsubscribe from any email with the link at the bottom.</li>
          <li>Reply STOP to any text to stop texts; HELP for help.</li>
          <li>Ask us to access, correct or delete your information by emailing [PRIVACY@EMAIL].</li>
        </ul>
      </LegalSection>
      <LegalSection title="Your state privacy rights">
        <p>
          Depending on where you live (for example California, Colorado, Connecticut, Virginia), you may have the right to know, access,
          correct and delete your personal information, and to opt out of its sale or use for targeted advertising. We do not sell personal
          information. To use these rights, email [PRIVACY@EMAIL]. We will not treat you differently for using them.
        </p>
      </LegalSection>
      <LegalSection title="How long we keep it">
        <p>
          We keep your account and alert settings while you use BigStocks. After you unsubscribe from everything, we delete or anonymize them
          within [X days], except consent and opt-out records, which we keep for [X years] as the law requires.
        </p>
      </LegalSection>
      <LegalSection title="Security">
        <p>
          We use encryption in transit, access controls and limited staff access. No system is perfectly secure; please tell us at
          [SECURITY@EMAIL] if you see a problem.
        </p>
      </LegalSection>
      <LegalSection title="Children">
        <p>BigStocks is for adults. It is not meant for anyone under 18, and we do not knowingly collect information from children.</p>
      </LegalSection>
      <LegalSection title="Changes to this policy">
        <p>If we make important changes, we will update the date above and tell you by email before they take effect.</p>
      </LegalSection>
    </LegalPage>
  );
}
