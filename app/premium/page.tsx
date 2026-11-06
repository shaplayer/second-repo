import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/sections/Footer";
import { PricingCards } from "@/components/sections/Pricing";
import { AlertForm } from "@/components/AlertForm";
import { links, plans } from "@/lib/site";

export const metadata: Metadata = {
  title: `Premium Stock Alerts: High-Conviction Picks for $${plans.premium.price}/month | BigStocks`,
  description: "BigStocks Premium: our highest-conviction stock picks, about 1 to 4 a month, by text and email, plus early access to Level 2 streaming (beta).",
};

export default function PremiumPage() {
  const checkoutLive = Boolean(links.premiumCheckout);
  return (
    <>
      <Nav />
      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="pointer-events-none absolute left-1/2 top-[-30%] h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand/[0.08] blur-[130px]" aria-hidden="true" />
          <div className="container-wide relative py-16 text-center md:py-20">
            <p className="eyebrow">BigStocks Premium</p>
            <h1 className="mx-auto mt-4 max-w-3xl text-[38px] font-semibold leading-[1.06] tracking-tight md:text-[52px]">
              Our highest-conviction picks. <span className="text-gradient">${plans.premium.price} a month.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[17px] text-muted">
              Free members get picks several times a week. Premium adds the ones we&apos;re most confident in: about one to four
              a month, short-term setups and longer-term holds, by text and email.
            </p>
          </div>
        </section>

        <section className="container-wide py-16 md:py-20">
          <div className="mx-auto max-w-[1040px]"><PricingCards source="premium-page" /></div>

          {!checkoutLive && (
            <div id="waitlist" className="card mx-auto mt-10 grid max-w-[1040px] grid-cols-1 gap-8 p-7 md:grid-cols-[1fr_1.1fr] md:items-center md:p-10">
              <div>
                <p className="eyebrow">Premium checkout opens soon</p>
                <h2 className="mt-3 text-[24px] font-semibold tracking-tight md:text-[28px]">Save your spot</h2>
                <p className="mt-2 text-[15px] text-muted">
                  Leave your email (and phone, if you like). We&apos;ll send your Premium link the day checkout opens, and you&apos;ll
                  start getting our free picks right away.
                </p>
              </div>
              <AlertForm source="premium-waitlist" layout="stacked" cta="Save my spot" />
            </div>
          )}
        </section>

      </main>
      <Footer />
    </>
  );
}
