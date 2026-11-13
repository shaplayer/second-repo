import type { Metadata } from "next";
import { InquiryForm } from "@/components/advertise/InquiryForm";
import { Shell } from "@/components/site/Shell";
import { audience } from "@/lib/config";

// Only the owner's verified audience numbers (lib/config.ts) appear here: sponsors will check them.
const n = (value: number) => value.toLocaleString("en-US");

export const metadata: Metadata = {
  title: "For public companies",
  description: `Put your news in front of ${n(audience.emailSubscribers)} investors. Sponsored news and email alerts, always labeled with who paid, how much and in what form.`,
};

const AUDIENCE = [
  { figure: `${n(audience.emailSubscribers)}+`, label: "investors signed up" },
  { figure: `${n(audience.dailyImpressions)}+`, label: "daily impressions" },
  { figure: `${n(audience.dailyClicks)}+`, label: "daily clicks" },
];

// Text alerts are not live yet (plan decision 15), so the packages offer email only.
const PACKAGES = [
  { tag: "News", name: "Featured news", highlight: false, items: ["Your release pinned at the top of Live news for a day", "Shown on related stock pages", "Labeled Sponsored"] },
  { tag: "Most popular", name: "Sponsored alert", highlight: true, items: ["Everything in Featured news", "Email alert to the full list", "Disclosure in every email"] },
  { tag: "Campaign", name: "Campaign", highlight: false, items: ["A month of featured news and alerts", "Report on opens and clicks", "One contact person"] },
];

export default function AdvertisePage() {
  return (
    <Shell>
      <section className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-3.5 px-4 pb-7 pt-8 text-center md:px-8 md:pt-11">
        <span className="eyebrow text-[13px]">For public companies</span>
        <h1 className="m-0 text-[32px] font-extrabold leading-[1.06] tracking-[-0.035em] md:text-[46px]">
          Put your news in front of {n(audience.emailSubscribers)} investors
        </h1>
        <p className="m-0 max-w-[620px] text-[17px] leading-[1.55] text-ink-2">
          Your press releases and filings already show up here the second they post. Sponsorship gets them to the people who follow your sector,
          by email, clearly labeled.
        </p>
        <a href="#talk" className="btn btn-dark btn-lg">Talk to us</a>
      </section>

      <section aria-label="Audience" className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-3 px-4 pb-7 sm:grid-cols-3 md:px-8">
        {AUDIENCE.map((a) => (
          <div key={a.label} className="card-mint flex flex-col gap-0.5 rounded-[22px] p-[18px]">
            <span className="num text-[28px] font-extrabold">{a.figure}</span>
            <span className="text-sm text-ink-2">{a.label}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="co-pk" className="mx-auto w-full max-w-[1000px] px-4 pb-7 md:px-8">
        <h2 id="co-pk" className="m-0 mb-3.5 text-center text-[26px] font-extrabold tracking-[-0.02em]">Packages</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {PACKAGES.map((p) => (
            <div key={p.name} className={`flex flex-col gap-2.5 rounded-[28px] p-6 ${p.highlight ? "bg-mint shadow-[0_0_0_2px_var(--color-brand)]" : "bg-white shadow-[0_0_0_1px_var(--color-line)]"}`}>
              <span className="eyebrow text-[13px]">{p.tag}</span>
              <h3 className="m-0 text-[22px] font-extrabold">{p.name}</h3>
              <ul className="m-0 flex list-disc flex-col gap-1.5 pl-[18px] text-[15px] leading-[1.45] text-ink-2">
                {p.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <a href="#talk" className="mt-auto pt-1 text-xl font-extrabold text-good no-underline hover:text-link-hover">Contact us for pricing →</a>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="co-look" className="mx-auto flex w-full max-w-[1000px] flex-wrap items-center gap-5 px-4 pb-7 md:px-8">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-2.5">
          <h2 id="co-look" className="m-0 text-2xl font-extrabold">Labeled, every time</h2>
          <p className="m-0 text-[15px] leading-[1.6] text-ink-2">
            Securities law (Section 17(b)) requires us to say who paid, how much and in what form. We put it on the page and in the email.
            Readers trust labeled news more, not less.
          </p>
          <p className="m-0 text-[15px] leading-[1.6] text-ink-2">Sponsored items are never counted with our free picks.</p>
        </div>
        <div role="group" aria-label="Example of a sponsored item"
          className="flex min-w-0 flex-[1_1_380px] flex-col gap-1.5 rounded-3xl bg-white px-5 py-[18px] shadow-[0_16px_40px_rgba(12,60,35,0.12),0_0_0_1px_var(--color-line)]">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-amber-bg px-2.5 py-[3px] text-xs font-extrabold text-amber">SPONSORED</span>
            <span className="rounded-full bg-chip px-2.5 py-[3px] text-xs font-extrabold text-ink-2">EXAMPLE</span>
          </span>
          <span className="text-[13px] text-muted">$ORCA · Press release · Business Wire</span>
          <span className="text-[17px] font-extrabold">Orca Mining reports new high-grade drill results</span>
          <span className="rounded-[10px] bg-[#fffaf0] px-2.5 py-2 text-[13px] leading-normal text-amber">
            Paid for by Orca Mining Corp.: $5,000 cash for this placement. BigStocks holds no shares.
          </span>
        </div>
      </section>

      <section id="talk" aria-labelledby="co-form" className="mx-auto w-full max-w-[760px] px-4 pb-14 md:px-8">
        <div className="card-dark flex flex-col gap-3 p-5 md:p-7">
          <h2 id="co-form" className="m-0 text-2xl font-extrabold">Talk to us</h2>
          <InquiryForm />
        </div>
      </section>
    </Shell>
  );
}
