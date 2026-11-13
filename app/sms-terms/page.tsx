// DRAFT TEMPLATE awaiting the owner's lawyer. Do not reword: the owner fills in the [BRACKETS] and the lawyer approves the text.
// Text alerts are a later add-on: while they are off (SMS_ENABLED is not "1") a notice at the top says so.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { smsEnabled } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "SMS terms",
  description: "How BigStocks text alerts work, what they cost, and how to stop them at any time.",
};

export default function SmsTermsPage() {
  return (
    <LegalPage
      title="SMS terms"
      updated="Last updated [DATE] · Effective [DATE]"
      intro="How BigStocks text alerts work, what they cost, and how to stop them at any time."
      notice={smsEnabled() ? undefined : (
        <>
          <strong className="text-ink">Text alerts are not switched on yet.</strong> BigStocks sends email only for now. These terms describe how
          text alerts will work when they start.
        </>
      )}
    >
      <LegalSection title="The program">
        <p>
          <strong>BigStocks Alerts</strong> sends recurring automated text messages with our free daily stock pick and news on the stocks you
          follow. You choose what you get in <Link href="/settings">Alert settings</Link>.
        </p>
      </LegalSection>
      <LegalSection title="How you join">
        <p>
          You join by entering your mobile number on BigStocks and replying YES to our confirmation text. Consent is not a condition of any
          purchase. We record the consent wording you agreed to, with the date and time.
        </p>
      </LegalSection>
      <LegalSection title="How often">
        <p>
          Up to [3] messages per day, typically one free pick on trading mornings plus news on stocks you follow. Volume depends on how many
          stocks you follow and how much news they post.
        </p>
      </LegalSection>
      <LegalSection title="Cost">
        <LegalCallout>Message and data rates may apply. BigStocks does not charge for texts.</LegalCallout>
      </LegalSection>
      <LegalSection title="Stop, help and quiet hours">
        <ul>
          <li>Reply <strong>STOP</strong> to any message to cancel. You will get one final confirmation text and no more.</li>
          <li>Reply <strong>HELP</strong> for help, or email [SUPPORT@EMAIL].</li>
          <li>You can set no-texts-at-night hours in <Link href="/settings">Alert settings</Link>.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Carriers">
        <p>Supported on major U.S. carriers. Carriers are not liable for delayed or undelivered messages.</p>
      </LegalSection>
      <LegalSection title="Not investment advice">
        <p>
          Texts contain information, not recommendations. Sponsored texts say so, along with who paid. See our{" "}
          <Link href="/disclaimer">Disclaimer</Link>.
        </p>
      </LegalSection>
      <LegalSection title="Privacy">
        <p>
          We never sell or share your mobile number with sponsors or for their marketing. See our <Link href="/privacy">Privacy policy</Link> for
          how we handle it.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
