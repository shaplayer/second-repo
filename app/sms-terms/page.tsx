import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/sections/Footer";
import { SMS_CONSENT_TEXT, SMS_PROGRAM } from "@/lib/sms-consent";

export const metadata: Metadata = { title: "SMS Terms | BigStocks" };

const SECTIONS: [string, string][] = [
  ["Program", `${SMS_PROGRAM} sends recurring automated text messages with pre-market stock alerts and related market updates to people who sign up on BigStocks.com.`],
  ["Consent", `You join by entering your mobile number and checking the consent box, which reads: "${SMS_CONSENT_TEXT}" Consent is not a condition of any purchase.`],
  ["Message frequency", "Message frequency varies, typically on market days."],
  ["Cost", "BigStocks text alerts are free. Message and data rates from your mobile carrier may apply."],
  ["Opt out", "Reply STOP to any message to unsubscribe at any time. You will receive one final message confirming you've been unsubscribed. Reply START to re-subscribe."],
  ["Help", "Reply HELP to any message for help."],
  ["Carriers", "Mobile carriers are not liable for delayed or undelivered messages."],
  ["Privacy", "We do not sell or share your mobile number or SMS opt-in data with third parties for their marketing purposes."],
  ["Not investment advice", "Alerts are for informational purposes only and are not investment advice. Sponsored alerts are labeled and include the compensation disclosure."],
];

export default function SmsTermsPage() {
  return (
    <>
      <Nav />
      <main className="container-wide max-w-3xl py-20 md:py-28">
        <p className="eyebrow">Text alerts</p>
        <h1 className="mt-4 text-[36px] font-semibold tracking-tight md:text-[44px]">SMS Terms</h1>
        <dl className="mt-12 divide-y divide-line border-y border-line">
          {SECTIONS.map(([t, d]) => (
            <div key={t} className="grid gap-2 py-6 md:grid-cols-[200px_1fr] md:gap-8">
              <dt className="text-[15px] font-semibold">{t}</dt>
              <dd className="text-[15px] leading-relaxed text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </main>
      <Footer />
    </>
  );
}
