import Link from "next/link";
import { Nav } from "./Nav";
import { Footer } from "./sections/Footer";
import { SignupForm } from "./SignupForm";
import { FeedSearch } from "./FeedSearch";
import { ArrowRight } from "./Icons";
import { links } from "@/lib/site";

export function SectionTabs({ active }: { active: "news" | "filings" | null }) {
  const tab = (on: boolean) =>
    `rounded-full px-4 py-2 text-[14px] transition-colors ${on ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink"}`;
  return (
    <nav aria-label="News sections" className="inline-flex rounded-full border border-line bg-surface p-1">
      <Link href="/news" className={tab(active === "news")} aria-current={active === "news" ? "page" : undefined}>Press releases</Link>
      <Link href="/filings" className={tab(active === "filings")} aria-current={active === "filings" ? "page" : undefined}>SEC filings</Link>
    </nav>
  );
}

/** Shared layout for /news, /filings and /news/[ticker]. */
export function NewsShell({ header, toolbar, children, sidebarTop, searchBase = "/news", searchValue = "" }: {
  header: React.ReactNode; toolbar?: React.ReactNode; children: React.ReactNode;
  sidebarTop?: React.ReactNode; searchBase?: string; searchValue?: string;
}) {
  return (
    <>
      <Nav />
      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="pointer-events-none absolute right-[-10%] top-[-40%] h-[520px] w-[520px] rounded-full bg-brand/[0.06] blur-[120px]" aria-hidden="true" />
          <div className="container-wide relative py-12 md:py-16">
            {header}
            <div className="mt-8 max-w-2xl"><FeedSearch key={searchValue} base={searchBase} defaultValue={searchValue} /></div>
          </div>
        </section>

        <div className="container-wide grid grid-cols-[minmax(0,1fr)] gap-6 py-10 md:py-14 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
          <div className="min-w-0">
            {toolbar && <div className="mb-4 flex flex-wrap items-center gap-2">{toolbar}</div>}
            <div className="card overflow-clip">{children}</div>
            <p className="mt-4 text-[12px] text-faint">
              Sources: SEC EDGAR · GlobeNewswire · PR Newswire · Business Wire · ACCESS Newswire. Headlines link to the original source. Times are US Eastern.
            </p>
          </div>

          <aside className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start" aria-label="Get alerts">
            {sidebarTop}
            <div className="card p-6">
              <p className="eyebrow">Free alerts</p>
              <h2 className="mt-3 text-[19px] font-semibold leading-snug tracking-tight">Get the next pick before the bell.</h2>
              <p className="mt-2 text-[14px] text-muted">Pre-market stock alerts by email or text. Free.</p>
              <div className="mt-5"><SignupForm source="news-sidebar" size="md" /></div>
            </div>
            <Link href={`${links.advertise}?package=spotlight#contact`} className="card group block p-6 transition-colors hover:border-brand/40">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">For public companies</p>
              <p className="mt-2 text-[16px] font-semibold leading-snug">Want your news in front of 125,000 traders?</p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-[14px] text-brand">Feature your press release <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
