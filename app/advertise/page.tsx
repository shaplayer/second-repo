import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/sections/Footer";
import { ChoosePackage, InquiryForm } from "@/components/InquiryForm";
import { Reveal } from "@/components/Reveal";
import { ArrowRight, Bolt, Inbox, Megaphone, Shield } from "@/components/Icons";
import { PACKAGES, formatUSD } from "@/lib/advertise";
import { audience } from "@/lib/site";
import { compact } from "@/lib/format";

export const metadata: Metadata = {
  title: "Advertise with BigStocks | Reach 125,000 traders",
  description:
    "Sponsor packages for public companies: put your press release in front of 125,000 email subscribers, 1M+ daily impressions and 5,000+ daily clicks.",
};

const STATS = [
  { value: audience.emailSubscribers.toLocaleString("en-US"), label: "Email subscribers" },
  { value: `${compact(audience.dailyImpressions)}+`, label: "Impressions per day" },
  { value: `${audience.dailyClicks.toLocaleString("en-US")}+`, label: "Clicks per day" },
  { value: "Pre-market", label: "When alerts land" },
];

const STEPS = [
  { icon: Inbox, title: "Tell us about your news", body: "Send your press release, ticker and timing using the form below." },
  { icon: Megaphone, title: "We prepare your campaign", body: "We draft the alert and placements, with the sponsored disclosure, for your approval." },
  { icon: Bolt, title: "Your news goes live", body: "Published on BigStocks.com and sent to our audience through every channel in your package." },
];

const FAQ = [
  {
    q: "Who is the BigStocks audience?",
    a: "Active traders and investors who signed up to get our free pre-market stock alerts. They open their inbox looking for the next stock to watch.",
  },
  {
    q: "Are sponsored placements disclosed?",
    a: "Always. Every paid alert and placement is labeled \"Sponsored\" with the compensation disclosed, as Section 17(b) of the Securities Act requires. It protects you and makes your news more credible to investors.",
  },
  {
    q: "What do you need from us?",
    a: "Your press release (or the news you plan to release), your ticker, preferred timing and a contact for approvals.",
  },
  {
    q: "Can we start with one release and upgrade later?",
    a: "Yes. Many companies start with a Press Release Spotlight and move to Ongoing Presence or Full Sponsorship. Tell us your goals in the form.",
  },
];

export default function AdvertisePage() {
  return (
    <>
      <Nav />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden" aria-labelledby="adv-hero">
          <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="pointer-events-none absolute left-1/2 top-[-20%] h-[640px] w-[1000px] -translate-x-1/2 rounded-full bg-brand/[0.08] blur-[140px]" aria-hidden="true" />
          <div className="container-wide relative pb-16 pt-16 text-center md:pb-20 md:pt-24">
            <p className="eyebrow">Advertise with BigStocks</p>
            <h1 id="adv-hero" className="mx-auto mt-5 max-w-4xl text-[38px] font-semibold leading-[1.06] tracking-[-0.03em] sm:text-[50px] xl:text-[58px]">
              Put your news in front of <span className="text-gradient">125,000 traders</span>, before the bell.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-muted">
              Your press release published on BigStocks.com and alerted to an audience that opens its inbox looking for the next stock to watch.
              More visibility, more exposure, fully disclosed.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <a href="#packages" className="btn-primary">See packages <ArrowRight /></a>
              <a href="#contact" className="btn-ghost !h-12">Request a campaign</a>
            </div>
          </div>

          <div className="container-wide relative pb-20 md:pb-28">
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-line bg-line md:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="flex flex-col-reverse bg-surface p-6 md:p-8">
                  <dt className="mt-1 text-[13.5px] text-muted">{s.label}</dt>
                  <dd className={`text-[30px] font-semibold tracking-tight md:text-[40px] ${/^\d/.test(s.value) ? "num" : ""}`}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Packages */}
        <section id="packages" className="container-wide pb-24 md:pb-32" aria-labelledby="pkg-title">
          <div className="mx-auto max-w-3xl text-center">
            <p className="eyebrow">Packages</p>
            <h2 id="pkg-title" className="mt-4 text-[34px] font-semibold leading-[1.1] tracking-tight md:text-[42px]">
              Pick your reach. <span className="text-muted">We handle distribution.</span>
            </h2>
          </div>

          <div className="mt-14 grid items-stretch gap-5 lg:grid-cols-3">
            {PACKAGES.map((p, i) => (
              <Reveal key={p.id} delay={i * 100} className="h-full">
                <article
                  className={`card flex h-full flex-col p-7 md:p-8 ${p.featured ? "border-brand/40 shadow-[0_0_0_1px_rgb(18_226_122/0.15),0_30px_80px_-30px_rgb(18_226_122/0.35)]" : ""}`}
                  aria-labelledby={`pkg-${p.id}`}
                >
                  {p.featured && (
                    <span className="absolute right-6 top-6 rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#04130b]">
                      Everything included
                    </span>
                  )}
                  <h3 id={`pkg-${p.id}`} className="text-[18px] font-semibold">{p.name}</h3>
                  <p className="mt-2 min-h-[48px] text-[14.5px] leading-relaxed text-muted">{p.summary}</p>
                  <p className="mt-6 flex items-baseline gap-2">
                    <span className="num text-[40px] font-semibold tracking-tight md:text-[44px]">{formatUSD(p.price)}</span>
                    <span className="text-[14px] text-faint">{p.cadence}</span>
                  </p>
                  <ul className="mt-7 space-y-3 border-t border-line pt-7">
                    {p.includes.map((item) => (
                      <li key={item} className="flex gap-3 text-[14.5px] leading-snug">
                        <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span className="text-ink/90">{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8 flex-1" />
                  <ChoosePackage id={p.id} className={p.featured ? "btn-primary w-full" : "btn-ghost !h-12 w-full"}>
                    Choose {p.name} <ArrowRight />
                  </ChoosePackage>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Process + trust */}
        <section className="container-wide pb-24 md:pb-32" aria-labelledby="process-title">
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div className="card p-7 md:p-10">
              <p className="eyebrow">How it works</p>
              <h2 id="process-title" className="mt-4 text-[28px] font-semibold tracking-tight md:text-[34px]">From your release to their inbox.</h2>
              <ol className="mt-8 grid gap-6 md:grid-cols-3">
                {STEPS.map((s, i) => (
                  <li key={s.title}>
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand"><s.icon /></span>
                    <p className="num mt-5 font-mono text-[12px] text-faint">0{i + 1}</p>
                    <h3 className="mt-1 text-[16px] font-semibold">{s.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="card relative overflow-hidden p-7 md:p-10">
              <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand/10 blur-[80px]" aria-hidden="true" />
              <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand"><Shield /></span>
              <h2 className="relative mt-6 text-[24px] font-semibold tracking-tight md:text-[28px]">Disclosed placements build trust.</h2>
              <p className="relative mt-3 text-[15px] leading-relaxed text-muted">
                Every sponsored alert is labeled and the compensation is disclosed (SEC §17(b)). Our public track record shows every alert, wins and losses.
                Investors trust what they read here, and that trust carries over to your company.
              </p>
            </div>
          </div>
        </section>

        {/* Contact + FAQ */}
        <section id="contact" className="container-wide pb-24 md:pb-32" aria-labelledby="contact-title">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-16">
            <div>
              <p className="eyebrow">Get started</p>
              <h2 id="contact-title" className="mt-4 text-[34px] font-semibold leading-[1.1] tracking-tight md:text-[42px]">
                Request a campaign.
              </h2>
              <p className="mt-5 text-[16px] leading-relaxed text-muted">Tell us about your company and your news. We&apos;ll come back with a plan and dates.</p>

              <div className="mt-10 divide-y divide-line border-y border-line">
                {FAQ.map((f) => (
                  <details key={f.q} className="group py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                      {f.q}
                      <span className="text-faint transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                    </summary>
                    <p className="mt-3 text-[14px] leading-relaxed text-muted">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
            <div className="card p-6 md:p-10">
              <InquiryForm />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
