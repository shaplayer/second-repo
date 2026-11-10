import Link from "next/link";
import { Nav } from "./Nav";
import { Footer } from "./sections/Footer";
import { SignupForm } from "./SignupForm";
import { FeedSearch } from "./FeedSearch";
import { ArrowRight } from "./Icons";
import { BellButton } from "./BellButton";
import { links } from "@/lib/site";
import { SOURCE_CREDITS } from "@/lib/feeds/sources";

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
export function NewsShell({ header, toolbar, children, sidebarTop, searchBase = "/news", searchValue = "", ticker }: {
  header: React.ReactNode; toolbar?: React.ReactNode; children: React.ReactNode;
  sidebarTop?: React.ReactNode; searchBase?: string; searchValue?: string;
  /** On a company page: the bell follows this ticker. */
  ticker?: string;
}) {
  return (
    <>
      <Nav />
      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="pointer-events-none absolute right-[-10%] top-[-40%] h-[520px] w-[520px] rounded-full bg-brand/[0.06] blur-[120px]" aria-hidden="true" />
          <div className="container-wide relative py-12 md:py-16">
            {/* The bell sits top-right, in plain view, so getting alerts is one click away. */}
            <div className="mb-6 flex justify-end md:absolute md:right-10 md:top-12 md:mb-0">
              <BellButton ticker={ticker} source={ticker ? "ticker-page-bell" : "news-bell"}
                label={ticker ? undefined : "Get news alerts by email & text"} className="!h-11 !text-[14px]" />
            </div>
            {header}
            <div className="mt-8 max-w-2xl"><FeedSearch key={searchValue} base={searchBase} defaultValue={searchValue} /></div>
          </div>
        </section>

        <div className="container-wide grid grid-cols-[minmax(0,1fr)] gap-6 py-10 md:py-14 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
              <BellButton ticker={ticker} source="feed-toolbar-bell" label={ticker ? `Alert me on $${ticker}` : "Alert me"} className="!h-9" />
            </div>
            <div className="card overflow-clip">{children}</div>
            <p className="mt-4 text-[12px] text-faint">
              Sources: {SOURCE_CREDITS}. Headlines link to the original source. Times are US Eastern.
            </p>
          </div>

          <aside className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start" aria-label="Get alerts">
            {sidebarTop}
            <div className="card p-6">
              <p className="eyebrow">Free stock alerts</p>
              <h2 className="mt-3 text-[19px] font-semibold leading-snug tracking-tight">Get our next winning pick.</h2>
              <p className="mt-2 text-[14px] text-muted">By email or text. Pre-market or at the open. Free.</p>
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
